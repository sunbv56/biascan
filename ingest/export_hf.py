"""Xuất các sách đã nạp trong Supabase thành dataset Hugging Face (parquet + dataset card)."""

import argparse
import json
import statistics
import sys
from collections import Counter
from pathlib import Path

from common import connect_db, dataset_path, load_settings, require
from textnorm import build_embed_text

APP_URL = "https://biascan.thuanbt.id.vn"
REPO_URL = "https://github.com/sunbv56/biascan"
SOURCE = "sunbv56/vi-OCR_VQA-desc"


def fetch_vectors(conn) -> dict[str, tuple[list[float], str]]:
    with conn.cursor() as cur:
        cur.execute("select image_id, text_embedding::text, embed_model from books where text_embedding is not null")
        return {i: (json.loads(v), m) for i, v, m in cur.fetchall()}


def raw_rows() -> list[dict]:
    rows, seen = [], set()
    with open(dataset_path(), encoding="utf-8") as f:
        for line in f:
            if line.strip():
                row = json.loads(line)
                if row.get("image_id") and row["image_id"] not in seen:
                    seen.add(row["image_id"])
                    rows.append(row)
    return rows


def build_records(rows: list[dict], vectors: dict) -> list[dict]:
    out = []
    for row in rows:
        hit = vectors.get(row["image_id"])
        if not hit:
            continue
        vec, model = hit
        out.append({
            "image_id": row["image_id"],
            "title": row.get("title") or "",
            "author": row.get("author") or "",
            "publisher": row.get("publisher") or "",
            "supplier": row.get("supplier") or "",
            "description": row.get("description") or "",
            "og_description": row.get("og_description") or "",
            "product_url": row.get("product_url") or "",
            "image_url": row.get("image_url") or "",
            "conversations": row.get("conversations") or [],
            "embed_text": build_embed_text(row),
            "embed_model": model,
            "text_embedding": vec,
        })
    return out


def top(counter: Counter, n: int) -> str:
    return "\n".join(f"| {k or '(trống)'} | {v} |" for k, v in counter.most_common(n))


def card(records: list[dict], repo_id: str) -> str:
    n = len(records)
    desc_lens = [len(r["description"]) for r in records]
    has_desc = sum(1 for r in records if r["description"].strip())
    publishers = Counter(r["publisher"].strip() for r in records)
    suppliers = Counter(r["supplier"].strip() for r in records)
    authors = {r["author"].strip() for r in records if r["author"].strip()}
    series = sum(1 for r in records if "tập" in r["title"].lower())
    turns = [len(r["conversations"]) for r in records]
    dims = len(records[0]["text_embedding"]) if records else 0
    model = records[0]["embed_model"] if records else ""
    first, last = records[0]["image_id"], records[-1]["image_id"]
    return f"""---
language:
- vi
pretty_name: BiaScan 950
size_categories:
- n<1K
task_categories:
- feature-extraction
- visual-question-answering
tags:
- books
- vietnamese
- embeddings
- retrieval
- ocr
---

# BiaScan 950

Kho {n} đầu sách tiếng Việt kèm vector embedding dùng cho app tra cứu sách bằng ảnh bìa / mô tả
**[BiaScan]({APP_URL})** ([mã nguồn]({REPO_URL})).

Lấy {n} dòng đầu (`{first}` … `{last}`) của [`{SOURCE}`](https://huggingface.co/datasets/{SOURCE}),
thêm cột `embed_text` (đúng chuỗi đã đem embed) và `text_embedding` ({dims} chiều, `{model}`).
Dùng lại vector để tìm kiếm ngữ nghĩa mà không phải gọi API embedding.

## Thống kê

| | |
|---|---|
| Số sách | {n} |
| Có mô tả | {has_desc} (độ dài trung vị {statistics.median(desc_lens):.0f} ký tự, tối đa {max(desc_lens)}) |
| Tác giả khác nhau | {len(authors)} |
| Nhà xuất bản khác nhau | {len(publishers)} |
| Tên có "Tập …" (bộ nhiều tập) | {series} |
| Lượt hỏi–đáp về bìa (`conversations`) | trung bình {statistics.mean(turns) / 2:.1f} cặp/sách |

Nhà xuất bản nhiều nhất:

| Nhà xuất bản | Số sách |
|---|---|
{top(publishers, 8)}

Nhà phát hành nhiều nhất:

| Nhà phát hành | Số sách |
|---|---|
{top(suppliers, 6)}

## Cột

| Cột | Ý nghĩa |
|---|---|
| `image_id` | Mã sách (`fahasa_N`), khớp dataset gốc |
| `title`, `author`, `publisher`, `supplier` | Thông tin sách |
| `description`, `og_description` | Mô tả đầy đủ từ trang sản phẩm |
| `product_url`, `image_url` | Trang sản phẩm và ảnh bìa |
| `conversations` | Các cặp hỏi–đáp về bìa (định dạng VQA) |
| `embed_text` | Văn bản đã embed: `title: … \\| text: Tác giả … Mô tả (≤ 2.000 ký tự)` |
| `embed_model` | Model embedding |
| `text_embedding` | Vector {dims} chiều, đã chuẩn hoá L2 (dùng cosine / tích vô hướng) |

## Dùng nhanh

```python
from datasets import load_dataset

ds = load_dataset("{repo_id}", split="train")
```

Câu hỏi phải embed cùng model với tiền tố `task: search result | query: …` (theo tài liệu Gemini cho
`{model}`), `output_dimensionality={dims}`, rồi chuẩn hoá L2.

## Nguồn và giới hạn

Dữ liệu sách lấy từ trang Fahasa, chỉ dùng cho nghiên cứu và minh hoạ; dự án không liên kết với Fahasa.
Giữ nguyên chính tả và nội dung mô tả của nguồn.
"""


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--repo", default="sunbv56/biascan-950")
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "out" / "hf")
    ap.add_argument("--no-upload", action="store_true")
    args = ap.parse_args(argv)

    import pyarrow as pa
    import pyarrow.parquet as pq

    settings = load_settings()
    require(settings, "database_url")
    with connect_db(settings.database_url) as conn:
        vectors = fetch_vectors(conn)
    records = build_records(raw_rows(), vectors)
    if not records:
        print("Không có sách nào có vector trong DB.", file=sys.stderr)
        return 1

    args.out.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(records)
    table = table.set_column(
        table.schema.get_field_index("text_embedding"),
        "text_embedding",
        pa.array([r["text_embedding"] for r in records], type=pa.list_(pa.float32())),
    )
    pq.write_table(table, args.out / "train.parquet")
    (args.out / "README.md").write_text(card(records, args.repo), encoding="utf-8")
    print(f"Đã ghi {len(records)} sách vào {args.out}")

    if args.no_upload:
        return 0
    from huggingface_hub import HfApi

    api = HfApi()
    api.create_repo(args.repo, repo_type="dataset", exist_ok=True)
    api.upload_file(path_or_fileobj=str(args.out / "train.parquet"), path_in_repo="data/train.parquet",
                    repo_id=args.repo, repo_type="dataset")
    api.upload_file(path_or_fileobj=str(args.out / "README.md"), path_in_repo="README.md",
                    repo_id=args.repo, repo_type="dataset")
    print(f"Đã đẩy lên https://huggingface.co/datasets/{args.repo}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
