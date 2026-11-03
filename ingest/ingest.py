"""Nạp 33.531 sách vào bảng books kèm text_embedding (idempotent theo image_id, resume được)."""

import argparse
import statistics
import sys

from common import (
    Embedder,
    QuotaExhausted,
    RateLimiter,
    chunks,
    connect_db,
    load_rows,
    load_settings,
    make_client,
    require,
)
from textnorm import DESC_MAX_CHARS, build_embed_text, normalize, pick_description

UPSERT_SQL = """
INSERT INTO books (
  image_id, title, author, publisher, supplier, description,
  product_url, image_url, title_norm, text_embedding, embed_model, updated_at
) VALUES (
  %(image_id)s, %(title)s, %(author)s, %(publisher)s, %(supplier)s, %(description)s,
  %(product_url)s, %(image_url)s, %(title_norm)s, %(text_embedding)s, %(embed_model)s, now()
)
ON CONFLICT (image_id) DO UPDATE SET
  title = EXCLUDED.title,
  author = EXCLUDED.author,
  publisher = EXCLUDED.publisher,
  supplier = EXCLUDED.supplier,
  description = EXCLUDED.description,
  product_url = EXCLUDED.product_url,
  image_url = EXCLUDED.image_url,
  title_norm = EXCLUDED.title_norm,
  text_embedding = EXCLUDED.text_embedding,
  image_embedding = CASE
    WHEN books.embed_model IS DISTINCT FROM EXCLUDED.embed_model THEN NULL
    ELSE books.image_embedding
  END,
  embed_model = EXCLUDED.embed_model,
  updated_at = now()
"""

DONE_SQL = "SELECT image_id FROM books WHERE text_embedding IS NOT NULL AND embed_model = %s"


def to_record(row: dict, max_chars: int) -> dict:
    return {
        "image_id": row["image_id"],
        "title": (row.get("title") or "").strip(),
        "author": (row.get("author") or "").strip(),
        "publisher": (row.get("publisher") or "").strip(),
        "supplier": (row.get("supplier") or "").strip(),
        "description": pick_description(row, max_chars),
        "product_url": row.get("product_url"),
        "image_url": row.get("image_url"),
        "title_norm": normalize(row.get("title")),
        "embed_text": build_embed_text(row, max_chars),
    }


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit", type=int, default=None, help="chỉ xử lý N sách đầu (chạy thử)")
    p.add_argument("--batch", type=int, default=100, help="số văn bản mỗi request (tối đa 100)")
    p.add_argument("--rpm", type=int, default=60, help="giới hạn request/phút (0 = không giới hạn)")
    p.add_argument(
        "--count-items",
        action="store_true",
        help="tính mỗi văn bản là 1 đơn vị RPM (nếu quota tính theo input, không theo request)",
    )
    p.add_argument("--max-retries", type=int, default=8)
    p.add_argument("--desc-max-chars", type=int, default=DESC_MAX_CHARS)
    p.add_argument("--force", action="store_true", help="embed lại cả dòng đã có cùng embed_model")
    p.add_argument("--dry-run", action="store_true", help="không gọi Gemini/DB; in mẫu văn bản embed")
    p.add_argument("--samples", type=int, default=3, help="số mẫu in ra khi --dry-run")
    args = p.parse_args(argv)
    if not 1 <= args.batch <= 100:
        p.error("--batch phải trong 1..100")
    return args


def dry_run(records: list[dict], samples: int) -> None:
    lengths = [len(r["embed_text"]) for r in records]
    no_desc = sum(1 for r in records if not r["description"])
    print(f"Số sách: {len(records)}")
    print(f"Không có mô tả (kể cả og_description): {no_desc}")
    print(
        f"Độ dài văn bản embed: min {min(lengths)}, trung vị {statistics.median(lengths):.0f}, "
        f"max {max(lengths)} ký tự"
    )
    for r in records[:samples]:
        print("\n" + "=" * 72)
        print(f"image_id: {r['image_id']}  |  title_norm: {r['title_norm']}")
        print("-" * 72)
        print(r["embed_text"])


def main(argv=None, *, client=None, conn=None) -> int:
    args = parse_args(argv)
    settings = load_settings()
    rows = load_rows()
    if args.limit:
        rows = rows[: args.limit]
    records = [to_record(r, args.desc_max_chars) for r in rows]

    if args.dry_run:
        dry_run(records, args.samples)
        return 0

    if client is None:
        require(settings, "gemini_api_key")
        client = make_client(settings.gemini_api_key)
    if conn is None:
        require(settings, "database_url")
        conn = connect_db(settings.database_url)

    if not args.force:
        with conn.cursor() as cur:
            cur.execute(DONE_SQL, (settings.embed_model,))
            done = {r[0] for r in cur.fetchall()}
        conn.commit()
        records = [r for r in records if r["image_id"] not in done]
        print(f"Đã có sẵn {len(done)} sách cùng model {settings.embed_model}; còn {len(records)} cần embed.")

    if not records:
        print("Không còn gì để làm.")
        return 0

    from tqdm import tqdm

    embedder = Embedder(
        client,
        settings.embed_model,
        settings.embed_dims,
        RateLimiter(args.rpm),
        max_retries=args.max_retries,
        count_items=args.count_items,
        log=tqdm.write,
    )
    written = 0
    try:
        with tqdm(total=len(records), unit="sách") as bar:
            for batch in chunks(records, args.batch):
                result = embedder.embed_texts([r["embed_text"] for r in batch])
                params = [
                    {**r, "text_embedding": vec, "embed_model": settings.embed_model}
                    for r, vec in zip(batch, result.vectors)
                ]
                with conn.cursor() as cur:
                    cur.executemany(UPSERT_SQL, params)
                conn.commit()
                written += len(batch)
                bar.update(len(batch))
    except QuotaExhausted as exc:
        conn.rollback()
        print(f"\nHết quota trong ngày ({str(exc)[:200]}). Đã ghi {written}; chạy lại lệnh sau để tiếp tục.")
        return 2
    except KeyboardInterrupt:
        conn.rollback()
        print(f"\nDừng tay. Đã ghi {written}; chạy lại lệnh để tiếp tục từ chỗ dở.")
        return 130
    finally:
        conn.close()

    print(f"Xong: ghi {written} sách.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
