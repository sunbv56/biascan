"""Chạy đánh giá BiaScan, ghi results.json đúng schema docs/CONTRACT.md."""

import argparse
import base64
import json
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from common import (DATA_DIR, DEFAULT_RESULTS, MODES, N_BOOKS, OUT_DIR, SETS, QuotaStop, Throttle,
                    catalog_ids, is_quota_exhausted_response, read_jsonl, settings, write_jsonl)
from metrics import rank_of, summarize
from textnorm import normalize

TOP_K = 10


@dataclass
class Item:
    set: str
    expected_id: str
    query: str | None = None
    image_path: Path | None = None

    @property
    def key(self) -> str:
        return f"{self.expected_id}|{self.image_path.name if self.image_path else self.query}"


def load_items(set_name: str, data_dir: Path, catalog: set[str], limit: int | None = None, log=print) -> list[Item]:
    folder = data_dir / set_name
    items, skipped = [], 0
    for r in read_jsonl(folder / "manifest.jsonl"):
        if r.get("expected_id", "") not in catalog:
            skipped += 1
            continue
        if set_name == "text_query":
            items.append(Item(set_name, r["expected_id"], query=r["query"]))
        else:
            items.append(Item(set_name, r["expected_id"], image_path=folder / r["query_image"]))
    if skipped:
        log(f"{set_name}: bỏ {skipped} mẫu có sách ngoài kho biascan-950")
    return items[:limit] if limit else items


def restrict_to(items: list[Item], ids: set[str], log=print) -> list[Item]:
    kept = [it for it in items if it.expected_id in ids]
    if len(kept) < len(items):
        log(f"Bỏ {len(items) - len(kept)} mẫu có sách đáp án không nằm trong bảng books")
    return kept


def modes_for(item_set: str, requested: list[str]) -> list[str]:
    if item_set == "text_query":
        return ["text"] if "text" in requested else []
    return requested


def image_bytes(item: Item) -> bytes:
    from augment import client_compress

    return client_compress(item.image_path.read_bytes())


class N8nBackend:
    def __init__(self, s, mode_label: str, min_interval: float, post=None, sleep=time.sleep):
        if not s.n8n_base_url or not s.biascan_token:
            raise SystemExit("Thiếu N8N_BASE_URL hoặc BIASCAN_TOKEN trong eval/.env")
        self.url = f"{s.n8n_base_url}/webhook/biascan-search"
        self.headers = {"x-biascan-token": s.biascan_token, "Content-Type": "application/json"}
        self.mode_label = mode_label
        self.throttle = Throttle(min_interval)
        self.session_id = f"eval-{uuid.uuid4().hex[:12]}"
        self.sleep = sleep
        if post is None:
            import requests

            post = requests.Session().post
        self.post = post

    def modes(self, item: Item, requested: list[str]) -> list[str]:
        return ["text"] if item.set == "text_query" else [self.mode_label]

    def run(self, item: Item, modes: list[str]) -> dict:
        body = {"session_id": self.session_id}
        if item.query is not None:
            body["query"] = item.query
        else:
            body["image"] = "data:image/jpeg;base64," + base64.b64encode(image_bytes(item)).decode()
        for attempt in range(4):
            self.throttle.wait()
            t0 = time.perf_counter()
            resp = self.post(self.url, json=body, headers=self.headers, timeout=120)
            ms = (time.perf_counter() - t0) * 1000
            if resp.status_code == 429:
                try:
                    payload = resp.json()
                except ValueError:
                    payload = None
                if is_quota_exhausted_response(resp.status_code, payload):
                    raise QuotaStop(f"n8n báo hết quota Gemini (quota_exhausted): {payload['error'].get('message', '')}")
            if resp.status_code == 429 and attempt < 3:
                self.sleep(65)
                continue
            if resp.status_code != 200:
                raise RuntimeError(f"HTTP {resp.status_code}: {resp.text[:200]}")
            data = resp.json()
            ids = [r["image_id"] for r in data.get("results", [])]
            return {m: {"ids": ids, "latency_ms": ms, "ocr_text": data.get("ocr_text")} for m in modes}
        raise QuotaStop("n8n trả 429 liên tục (rate limit theo phút/ngày)")


def vec(v: list[float] | None) -> str | None:
    return None if v is None else "[" + ",".join(f"{x:.7g}" for x in v) + "]"


class DirectBackend:
    SQL = {
        "text": "select image_id from match_books_text(%s::vector, %s, %s)",
        "image": "select image_id from match_books_image(%s::vector, %s)",
        "hybrid": "select image_id from match_books_hybrid(%s::vector, %s::vector, %s, %s)",
    }

    def __init__(self, s, gemini, cursor_factory, cache_path: Path | None = None):
        self.g = gemini
        self.cursor = cursor_factory
        self.cache_path = cache_path
        self.cache = {}
        if cache_path:
            for r in read_jsonl(cache_path):
                self.cache[r["key"]] = r

    def modes(self, item: Item, requested: list[str]) -> list[str]:
        return modes_for(item.set, requested)

    def _timed(self, fn):
        t0 = time.perf_counter()
        out = fn()
        wall = (time.perf_counter() - t0) * 1000
        api_ms = getattr(self.g, "last_call_ms", None)
        return out, wall if api_ms is None else api_ms

    def features(self, item: Item, modes: list[str]) -> dict:
        f = self.cache.get(item.key, {"key": item.key})
        changed = False
        need_text = "text" in modes or "hybrid" in modes
        need_image = item.image_path is not None and ("image" in modes or "hybrid" in modes)
        jpeg = None
        try:
            if item.image_path is not None and need_text and "ocr_text" not in f:
                jpeg = image_bytes(item)
                f["ocr_text"], f["ocr_ms"] = self._timed(lambda: self.g.ocr(jpeg))
                changed = True
            if need_text and "text_emb" not in f:
                text = item.query if item.query is not None else f["ocr_text"]
                if text.strip():
                    f["text_emb"], f["text_emb_ms"] = self._timed(lambda: self.g.embed_text(text))
                else:
                    f["text_emb"], f["text_emb_ms"] = None, 0.0
                changed = True
            if need_image and "image_emb" not in f:
                jpeg = jpeg or image_bytes(item)
                f["image_emb"], f["image_emb_ms"] = self._timed(lambda: self.g.embed_image(jpeg))
                changed = True
        finally:
            if changed:
                self.cache[item.key] = f
                if self.cache_path:
                    self.cache_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(self.cache_path, "a", encoding="utf-8") as fh:
                        fh.write(json.dumps(f) + "\n")
        return f

    def search(self, mode: str, f: dict, query_norm: str) -> tuple[list[str], float]:
        if mode == "text":
            params = (vec(f["text_emb"]), query_norm, TOP_K)
        elif mode == "image":
            params = (vec(f["image_emb"]), TOP_K)
        else:
            params = (vec(f["text_emb"]), vec(f.get("image_emb")), query_norm, TOP_K)
        t0 = time.perf_counter()
        with self.cursor() as cur:
            cur.execute(self.SQL[mode], params)
            ids = [row[0] for row in cur.fetchall()]
        return ids, (time.perf_counter() - t0) * 1000

    def run(self, item: Item, modes: list[str]) -> dict:
        f = self.features(item, modes)
        text = item.query if item.query is not None else f.get("ocr_text", "")
        qnorm = normalize(text)
        ocr_ms = f.get("ocr_ms", 0.0)
        out = {}
        has_text, has_image = f.get("text_emb") is not None, f.get("image_emb") is not None
        for m in modes:
            pre = {
                "text": ocr_ms + f.get("text_emb_ms", 0.0),
                "image": f.get("image_emb_ms", 0.0),
                "hybrid": ocr_ms + f.get("text_emb_ms", 0.0) + f.get("image_emb_ms", 0.0),
            }[m]
            rpc_mode = m
            if m == "hybrid" and not has_text:
                rpc_mode = "image" if has_image else None
            if (rpc_mode == "text" and not has_text) or (rpc_mode == "image" and not has_image):
                rpc_mode = None
            ids, rpc_ms = self.search(rpc_mode, f, qnorm) if rpc_mode else ([], 0.0)
            out[m] = {"ids": ids, "latency_ms": pre + rpc_ms, "ocr_text": text}
        return out


def evaluate(items: list[Item], backend, requested_modes: list[str], log=print) -> list[dict]:
    records = []
    for i, item in enumerate(items, 1):
        modes = backend.modes(item, requested_modes)
        if not modes:
            continue
        base = {"set": item.set, "expected_id": item.expected_id,
                "query": item.query if item.query is not None else item.image_path.name}
        stop = None
        try:
            res = backend.run(item, modes)
            for m in modes:
                r = res[m]
                records.append({**base, "mode": m, "rank": rank_of(item.expected_id, r["ids"][:TOP_K]),
                                "latency_ms": r["latency_ms"], "ocr_text": r.get("ocr_text"),
                                "top_ids": r["ids"][:TOP_K], "error": None})
        except Exception as exc:  # noqa: BLE001
            stop = str(exc)[:300] if isinstance(exc, QuotaStop) else None
            for m in modes:
                records.append({**base, "mode": m, "rank": None, "latency_ms": None,
                                "ocr_text": None, "top_ids": [], "error": str(exc)[:300]})
        if stop:
            log(f"DỪNG ở mẫu {i}/{len(items)}: {stop}")
            break
        if i % 10 == 0 or i == len(items):
            log(f"  {item.set}: {i}/{len(items)}")
    return records


def pick_examples(records: list[dict], per_set: int = 3) -> list[dict]:
    examples = []
    for set_name in SETS:
        rs = [r for r in records if r["set"] == set_name and r["error"] is None]
        if not rs:
            continue
        present = {r["mode"] for r in rs}
        primary = "hybrid" if "hybrid" in present else ("text" if "text" in present else sorted(present)[0])
        rs = [r for r in rs if r["mode"] == primary]
        hits = [r for r in rs if r["rank"] is not None][: per_set - 1]
        misses = [r for r in rs if r["rank"] is None][: per_set - len(hits)]
        for r in hits + misses:
            q = r["query"]
            if set_name != "text_query" and r.get("ocr_text"):
                q = r["ocr_text"].replace("\n", " ")[:200]
            examples.append({"set": set_name, "query": q, "expected_id": r["expected_id"], "hit_rank": r["rank"]})
    return examples


def build_results(records: list[dict], models: dict, n_books: int, previous: dict | None = None) -> dict:
    runs = {}
    if previous and previous.get("status") == "measured":
        for run in previous.get("runs", []):
            runs[(run["set"], run["mode"])] = run
    groups = {}
    for r in records:
        groups.setdefault((r["set"], r["mode"]), []).append(r)
    for (set_name, mode), rs in groups.items():
        lat = [r["latency_ms"] for r in rs if r["error"] is None and r["latency_ms"] is not None]
        runs[(set_name, mode)] = {"set": set_name, "mode": mode, **summarize([r["rank"] for r in rs], lat)}
    order = {s: i for i, s in enumerate(SETS)} | {m: i for i, m in enumerate(MODES)}
    examples = pick_examples(records)
    if previous and previous.get("status") == "measured":
        new_sets = {e["set"] for e in examples}
        examples = [e for e in previous.get("examples", []) if e["set"] not in new_sets] + examples
    return {
        "status": "measured",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "n_books": n_books,
        "models": models,
        "runs": sorted(runs.values(), key=lambda r: (order[r["set"]], order[r["mode"]])),
        "examples": examples,
    }


def write_results(path: Path, results: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--via", choices=["n8n", "direct"], required=True)
    ap.add_argument("--sets", default=",".join(SETS))
    ap.add_argument("--modes", default=",".join(MODES), help="direct: text,image,hybrid")
    ap.add_argument("--n8n-mode", choices=MODES, default="text",
                    help="nhãn mode cho tập ảnh khi đi qua n8n (text nếu workflow chỉ OCR→text, hybrid nếu có RRF ảnh)")
    ap.add_argument("--limit", type=int, help="giới hạn số mẫu mỗi tập (chạy thử)")
    ap.add_argument("--data-dir", type=Path, default=DATA_DIR)
    ap.add_argument("--out", type=Path, default=DEFAULT_RESULTS)
    ap.add_argument("--merge", action="store_true", help="giữ các run (set, mode) cũ không chạy lại")
    ap.add_argument("--min-interval", type=float, default=None,
                    help="giây giữa 2 request (mặc định n8n 6.5 vì rate limit 10/phút, direct 4.5 cho Gemini free)")
    ap.add_argument("--n-books", type=int, default=N_BOOKS)
    ap.add_argument("--dataset", type=Path, help="file train.parquet/.jsonl có sẵn (mặc định tải sunbv56/biascan-950 từ HF)")
    ap.add_argument("--max-error-rate", type=float, default=0.05,
                    help="tỉ lệ truy vấn lỗi tối đa; vượt thì không ghi results.json (mặc định 0.05)")
    args = ap.parse_args(argv)
    if args.limit and args.out.resolve() == DEFAULT_RESULTS.resolve():
        ap.error("--limit là chạy thử: thêm --out <file khác> để không ghi đè web/public/eval/results.json")

    s = settings()
    sets = [x for x in args.sets.split(",") if x]
    modes = [m for m in args.modes.split(",") if m]
    bad = [x for x in sets if x not in SETS] + [m for m in modes if m not in MODES]
    if bad:
        ap.error(f"giá trị không hợp lệ: {bad}")

    catalog = catalog_ids(args.dataset)
    items = []
    for set_name in sets:
        got = load_items(set_name, args.data_dir, catalog, args.limit)
        print(f"{set_name}: {len(got)} mẫu")
        items += got
    if not items:
        print("Không có mẫu nào. Chạy build_sets.py trước.")
        return 1

    n_books = args.n_books
    if args.via == "n8n":
        backend = N8nBackend(s, args.n8n_mode, 6.5 if args.min_interval is None else args.min_interval)
        models = {"ocr": s.ocr_model, "embed": s.embed_model, "rerank": ""}
        conn = None
    else:
        import psycopg

        from gemini import Gemini

        if not s.database_url:
            raise SystemExit("Thiếu DATABASE_URL trong eval/.env")
        conn = psycopg.connect(s.database_url, autocommit=True, prepare_threshold=None)
        with conn.cursor() as cur:
            cur.execute("select image_id from books")
            db_ids = {row[0] for row in cur.fetchall() if row[0] in catalog}
            n_books = len(db_ids)
            items = restrict_to(items, db_ids)
            if not items:
                raise SystemExit("Không còn mẫu nào có sách đáp án trong bảng books")
            if {"image", "hybrid"} & set(modes) and any(x != "text_query" for x in sets):
                cur.execute("select count(*) from books where image_embedding is not null")
                if cur.fetchone()[0] == 0:
                    raise SystemExit("DB chưa có image_embedding nào: bỏ image,hybrid khỏi --modes")
        gem = Gemini(s, min_interval=4.5 if args.min_interval is None else args.min_interval)
        backend = DirectBackend(s, gem, conn.cursor, OUT_DIR / "cache" / f"direct-{s.ocr_model}-{s.embed_model}-{s.embed_dims}.jsonl")
        models = {"ocr": s.ocr_model, "embed": s.embed_model, "rerank": ""}

    planned = sum(len(backend.modes(it, modes)) for it in items)
    try:
        records = evaluate(items, backend, modes)
    finally:
        if conn is not None:
            conn.close()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    write_jsonl(OUT_DIR / f"details-{args.via}-{stamp}.jsonl", records)
    errors = sum(1 for r in records if r["error"])
    details = OUT_DIR / f"details-{args.via}-{stamp}.jsonl"
    if len(records) < planned or not records or errors / len(records) > args.max_error_rate:
        print(f"KHÔNG ghi {args.out}: chạy {len(records)}/{planned} lượt, {errors} lỗi "
              f"(ngưỡng {args.max_error_rate:.0%}). Xem {details}, sửa rồi chạy lại (cache giữ kết quả đã có).")
        return 2
    previous = None
    if args.merge and args.out.exists():
        previous = json.loads(args.out.read_text(encoding="utf-8"))
    results = build_results(records, models, n_books, previous)
    write_results(args.out, results)
    for run in results["runs"]:
        print(json.dumps(run, ensure_ascii=False))
    print(f"Lỗi: {errors} (tính là trượt). Chi tiết: {details}")
    print(f"Đã ghi {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
