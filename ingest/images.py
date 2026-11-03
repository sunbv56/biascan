import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

from common import fetch_image

UPDATE_IMAGE_SQL = """
UPDATE books SET image_embedding = %(image_embedding)s, updated_at = now()
WHERE image_id = %(image_id)s AND embed_model = %(embed_model)s
"""


@dataclass
class Downloaded:
    image_id: str
    image_url: str
    data: bytes | None
    mime: str | None
    download_ms: float
    error: str | None


def download_all(http, rows: list[dict], workers: int = 8) -> list[Downloaded]:
    def one(row: dict) -> Downloaded:
        t0 = time.perf_counter()
        try:
            data, mime = fetch_image(http, row["image_url"])
            return Downloaded(row["image_id"], row["image_url"], data, mime, (time.perf_counter() - t0) * 1000, None)
        except Exception as exc:
            return Downloaded(row["image_id"], row["image_url"], None, None, (time.perf_counter() - t0) * 1000, str(exc)[:300])

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        return list(pool.map(one, rows))


def write_image_embeddings(conn, items: list[tuple[str, object]], embed_model: str) -> int:
    params = [
        {"image_id": image_id, "image_embedding": vec, "embed_model": embed_model}
        for image_id, vec in items
    ]
    updated = 0
    with conn.cursor() as cur:
        for p in params:
            cur.execute(UPDATE_IMAGE_SQL, p)
            updated += cur.rowcount
    conn.commit()
    return updated
