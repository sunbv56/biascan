"""Probe N ảnh bìa: đo token/ảnh, thời gian, lỗi 429 của gemini-embedding-2 rồi ước tính cho toàn bộ."""

import argparse
import json
import random
import statistics
import sys
import time
from datetime import datetime, timezone

from common import (
    N_BOOKS,
    OUT_DIR,
    Embedder,
    QuotaExhausted,
    RateLimiter,
    connect_db,
    load_rows,
    load_settings,
    make_client,
    make_http,
    percentile,
    require,
)
from images import download_all, write_image_embeddings

# Bảng giá ai.google.dev/gemini-api/docs/pricing (tra 03/11/2026), Standard tier trả phí.
PRICE_IMAGE_PER_M_TOKENS = 0.45
PRICE_PER_IMAGE = 0.00012


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("-n", "--n", type=int, default=100)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--rpm", type=int, default=60, help="giới hạn request/phút gửi Gemini")
    p.add_argument("--rpd", type=int, default=1000, help="quota request/ngày free tier (xem AI Studio) để ước tính")
    p.add_argument("--max-retries", type=int, default=8)
    p.add_argument("--workers", type=int, default=8, help="luồng tải ảnh song song")
    p.add_argument("--write-db", action="store_true", help="ghi image_embedding cho ảnh probe thành công")
    p.add_argument("--dry-run", action="store_true", help="chỉ tải ảnh, không gọi Gemini/DB")
    p.add_argument("--out", default=str(OUT_DIR / "probe.json"))
    return p.parse_args(argv)


def count_tokens_fallback(client, model: str, data: bytes, mime: str) -> int | None:
    from google.genai import types

    resp = client.models.count_tokens(
        model=model,
        contents=[types.Content(parts=[types.Part.from_bytes(data=data, mime_type=mime)])],
    )
    return getattr(resp, "total_tokens", None)


def estimate(tokens: list[int], embed_ms: list[float], rpm: int, rpd: int, n_total: int = N_BOOKS) -> dict:
    mean_tokens = statistics.fmean(tokens) if tokens else None
    total_tokens = mean_tokens * n_total if mean_tokens is not None else None
    minutes_by_rpm = n_total / rpm if rpm > 0 else None
    days_by_rpd = n_total / rpd if rpd > 0 else None
    mean_ms = statistics.fmean(embed_ms) if embed_ms else None
    sequential_hours = mean_ms * n_total / 3_600_000 if mean_ms is not None else None
    return {
        "n_total": n_total,
        "assumption": "1 ảnh / request (đếm quota theo request); nếu gộp nhiều ảnh/request mà quota tính theo request thì nhanh hơn",
        "mean_tokens_per_image": mean_tokens,
        "total_tokens": total_tokens,
        "free_tier_cost_usd": 0.0,
        "paid_cost_usd_by_tokens": total_tokens * PRICE_IMAGE_PER_M_TOKENS / 1e6 if total_tokens else None,
        "paid_cost_usd_by_image": PRICE_PER_IMAGE * n_total,
        "rpm": rpm,
        "rpd": rpd,
        "hours_if_rpm_bound": minutes_by_rpm / 60 if minutes_by_rpm else None,
        "days_if_rpd_bound": days_by_rpd,
        "sequential_latency_hours": sequential_hours,
        "estimated_days": max(
            filter(None, [days_by_rpd, (minutes_by_rpm or 0) / 1440, (sequential_hours or 0) / 24]),
            default=None,
        ),
    }


def fmt(v, nd=1):
    if v is None:
        return "—"
    return f"{v:,.{nd}f}" if isinstance(v, float) else f"{v:,}"


def print_summary(summary: dict) -> None:
    s, e = summary["stats"], summary["estimate"]
    lines = [
        ("Ảnh probe", fmt(summary["n"])),
        ("Tải ảnh lỗi", fmt(s["download_errors"])),
        ("Embed thành công", fmt(s["embedded"])),
        ("Embed lỗi", fmt(s["embed_errors"])),
        ("Số lần 429", fmt(s["rate_limited"])),
        ("Token/ảnh TB (p50/p95)", f"{fmt(s['tokens_mean'])} ({fmt(s['tokens_p50'])}/{fmt(s['tokens_p95'])})"),
        ("Nguồn số token", s["token_source"] or "không đo được"),
        ("Thời gian embed ms p50/p95", f"{fmt(s['embed_ms_p50'])}/{fmt(s['embed_ms_p95'])}"),
        ("Thời gian tải ảnh ms p50", fmt(s["download_ms_p50"])),
        ("Kích thước ảnh KB TB", fmt(s["bytes_mean_kb"])),
        ("— Ước tính cho", f"{e['n_total']:,} ảnh"),
        ("Tổng token", fmt(e["total_tokens"], 0)),
        ("Chi phí free tier", "0 USD"),
        ("Nếu trả phí (theo token/ảnh)", f"{fmt(e['paid_cost_usd_by_tokens'], 2)} / {fmt(e['paid_cost_usd_by_image'], 2)} USD"),
        (f"Giờ nếu chỉ vướng RPM={e['rpm']}", fmt(e["hours_if_rpm_bound"])),
        (f"Ngày nếu vướng RPD={e['rpd']}", fmt(e["days_if_rpd_bound"])),
        ("Ước tính số ngày", fmt(e["estimated_days"])),
    ]
    width = max(len(k) for k, _ in lines)
    for k, v in lines:
        print(f"{k.ljust(width)}  {v}")


def main(argv=None, *, client=None, conn=None, http=None, rows=None) -> int:
    args = parse_args(argv)
    settings = load_settings()
    rows = rows if rows is not None else load_rows()
    sample = random.Random(args.seed).sample(rows, min(args.n, len(rows)))

    http = http or make_http()
    t0 = time.perf_counter()
    downloads = download_all(http, sample, args.workers)
    print(f"Tải {len(downloads)} ảnh trong {time.perf_counter() - t0:.1f}s")

    if not args.dry_run and client is None:
        require(settings, "gemini_api_key")
        client = make_client(settings.gemini_api_key)

    from tqdm import tqdm

    embedder = None
    if not args.dry_run:
        embedder = Embedder(
            client,
            settings.embed_model,
            settings.embed_dims,
            RateLimiter(args.rpm),
            max_retries=args.max_retries,
            log=tqdm.write,
        )

    items: list[dict] = []
    vectors: list[tuple[str, object]] = []
    token_source = None
    count_tokens_ok = True
    quota_hit = False
    for d in tqdm(downloads, unit="ảnh", disable=args.dry_run):
        item = {
            "image_id": d.image_id,
            "image_url": d.image_url,
            "bytes": len(d.data) if d.data else None,
            "mime": d.mime,
            "download_ms": round(d.download_ms, 1),
            "download_error": d.error,
            "embed_ms": None,
            "tokens": None,
            "retries": 0,
            "rate_limited": 0,
            "embed_error": None,
        }
        items.append(item)
        if embedder is None or d.data is None or quota_hit:
            continue
        try:
            res = embedder.embed_images([(d.data, d.mime)])
        except QuotaExhausted as exc:
            item["embed_error"] = f"quota/ngày: {str(exc)[:200]}"
            quota_hit = True
            continue
        except Exception as exc:
            item["embed_error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
            continue
        item.update(
            embed_ms=round(res.elapsed_s * 1000, 1),
            retries=res.retries,
            rate_limited=res.rate_limited,
            tokens=res.token_counts[0],
        )
        if item["tokens"] is not None:
            token_source = "embeddings[].statistics.token_count"
        elif count_tokens_ok:
            try:
                item["tokens"] = count_tokens_fallback(client, settings.embed_model, d.data, d.mime)
                token_source = token_source or "models.count_tokens"
            except Exception as exc:
                count_tokens_ok = False
                tqdm.write(f"count_tokens không dùng được với {settings.embed_model}: {str(exc)[:160]}")
        vectors.append((d.image_id, res.vectors[0]))

    tokens = [i["tokens"] for i in items if i["tokens"] is not None]
    embed_ms = [i["embed_ms"] for i in items if i["embed_ms"] is not None]
    sizes = [i["bytes"] for i in items if i["bytes"]]
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model": settings.embed_model,
        "dims": settings.embed_dims,
        "dry_run": args.dry_run,
        "n": len(items),
        "seed": args.seed,
        "stats": {
            "download_errors": sum(1 for i in items if i["download_error"]),
            "embedded": len(embed_ms),
            "embed_errors": sum(1 for i in items if i["embed_error"]),
            "rate_limited": sum(i["rate_limited"] for i in items),
            "quota_exhausted": quota_hit,
            "token_source": token_source,
            "tokens_mean": statistics.fmean(tokens) if tokens else None,
            "tokens_p50": percentile(tokens, 50),
            "tokens_p95": percentile(tokens, 95),
            "embed_ms_p50": percentile(embed_ms, 50),
            "embed_ms_p95": percentile(embed_ms, 95),
            "download_ms_p50": percentile([i["download_ms"] for i in items], 50),
            "bytes_mean_kb": statistics.fmean(sizes) / 1024 if sizes else None,
            "mime": {m: sum(1 for i in items if i["mime"] == m) for m in {i["mime"] for i in items}},
        },
        "estimate": estimate(tokens, embed_ms, args.rpm, args.rpd),
        "items": items,
    }

    if args.write_db and vectors:
        if conn is None:
            require(settings, "database_url")
            conn = connect_db(settings.database_url)
        try:
            updated = write_image_embeddings(conn, vectors, settings.embed_model)
        finally:
            conn.close()
        summary["db_updated"] = updated
        print(f"Ghi image_embedding: {updated}/{len(vectors)} dòng (dòng thiếu = chưa chạy ingest.py text hoặc khác embed_model)")

    from pathlib import Path

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print_summary(summary)
    print(f"Đã ghi {out}")
    return 2 if quota_hit else 0


if __name__ == "__main__":
    sys.exit(main())
