"""Phase 2: nạp image_embedding cho các sách đã có text_embedding (idempotent, resume được)."""

import argparse
import json
import sys
from datetime import datetime, timezone

from common import (
    OUT_DIR,
    Embedder,
    QuotaExhausted,
    RateLimiter,
    chunks,
    connect_db,
    load_settings,
    make_client,
    make_http,
    require,
)
from images import download_all, write_image_embeddings

PENDING_SQL = """
SELECT image_id, image_url FROM books
WHERE text_embedding IS NOT NULL AND embed_model = %(model)s
  AND image_url IS NOT NULL AND image_url <> ''
  AND (%(force)s OR image_embedding IS NULL)
ORDER BY image_id
"""


def parse_args(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--batch", type=int, default=6, help="số ảnh mỗi request (mỗi ảnh 1 embedding riêng)")
    p.add_argument("--rpm", type=int, default=60)
    p.add_argument("--count-items", action="store_true", help="tính mỗi ảnh là 1 đơn vị RPM")
    p.add_argument("--max-retries", type=int, default=8)
    p.add_argument("--workers", type=int, default=8)
    p.add_argument("--force", action="store_true", help="embed lại cả ảnh đã có image_embedding")
    p.add_argument("--failures", default=str(OUT_DIR / "image_failures.jsonl"))
    args = p.parse_args(argv)
    if args.batch < 1:
        p.error("--batch phải >= 1")
    return args


def main(argv=None, *, client=None, conn=None, http=None) -> int:
    args = parse_args(argv)
    settings = load_settings()
    if client is None:
        require(settings, "gemini_api_key")
        client = make_client(settings.gemini_api_key)
    if conn is None:
        require(settings, "database_url")
        conn = connect_db(settings.database_url)

    with conn.cursor() as cur:
        cur.execute(PENDING_SQL, {"model": settings.embed_model, "force": args.force})
        pending = [{"image_id": r[0], "image_url": r[1]} for r in cur.fetchall()]
    conn.commit()
    if args.limit:
        pending = pending[: args.limit]
    print(f"Cần embed ảnh: {len(pending)} sách (model {settings.embed_model}).")
    if not pending:
        conn.close()
        return 0

    from pathlib import Path

    from tqdm import tqdm

    http = http or make_http()
    fail_path = Path(args.failures)
    fail_path.parent.mkdir(parents=True, exist_ok=True)
    embedder = Embedder(
        client,
        settings.embed_model,
        settings.embed_dims,
        RateLimiter(args.rpm),
        max_retries=args.max_retries,
        count_items=args.count_items,
        log=tqdm.write,
    )
    written = failed = 0
    code = 0
    try:
        with tqdm(total=len(pending), unit="ảnh") as bar, open(fail_path, "a", encoding="utf-8") as fails:
            for batch in chunks(pending, args.batch):
                downloads = download_all(http, batch, args.workers)
                ok = [d for d in downloads if d.data is not None]
                for d in downloads:
                    if d.error:
                        failed += 1
                        fails.write(json.dumps({
                            "image_id": d.image_id,
                            "image_url": d.image_url,
                            "error": d.error,
                            "at": datetime.now(timezone.utc).isoformat(),
                        }, ensure_ascii=False) + "\n")
                if ok:
                    res = embedder.embed_images([(d.data, d.mime) for d in ok])
                    written += write_image_embeddings(
                        conn, [(d.image_id, v) for d, v in zip(ok, res.vectors)], settings.embed_model
                    )
                bar.update(len(batch))
    except QuotaExhausted as exc:
        conn.rollback()
        print(f"\nHết quota trong ngày ({str(exc)[:200]}). Chạy lại lệnh sau khi quota reset để tiếp tục.")
        code = 2
    except KeyboardInterrupt:
        conn.rollback()
        print("\nDừng tay. Chạy lại lệnh để tiếp tục từ chỗ dở.")
        code = 130
    finally:
        conn.close()

    print(f"Ghi {written} image_embedding; tải ảnh lỗi {failed} (xem {fail_path}).")
    return code


if __name__ == "__main__":
    sys.exit(main())
