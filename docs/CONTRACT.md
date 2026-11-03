# BiaScan — hợp đồng giữa các phần

Mọi phần (`supabase/`, `ingest/`, `n8n/`, `eval/`, `web/`) phải khớp đúng tên dưới đây.

## Supabase

Extension: `vector`, `unaccent`.

### Bảng `books`

| cột | kiểu |
|---|---|
| `image_id` | `text primary key` (vd `fahasa_0`) |
| `title`, `author`, `publisher`, `supplier` | `text` |
| `description` | `text` (đã cắt ≤ 2000 ký tự) |
| `product_url`, `image_url` | `text` |
| `title_norm` | `text` — lowercase, bỏ dấu, gộp khoảng trắng (đ → d) |
| `text_embedding` | `vector(768)` |
| `image_embedding` | `vector(768)` null (phase 2 / probe) |
| `embed_model` | `text` |
| `updated_at` | `timestamptz default now()` |

Index HNSW `vector_cosine_ops` trên 2 cột vector; trigram (`pg_trgm`) trên `title_norm`.

Văn bản đem embed theo định dạng tài liệu Gemini khuyên cho `gemini-embedding-2` (không có `task_type`).
`description` rỗng thì lấy `og_description`; `title` rỗng thì ghi `none`.

Tài liệu (ingest):

```
title: {title} | text: Tác giả: {author}
Nhà xuất bản: {publisher}
Nhà phát hành: {supplier}
Mô tả: {description[:2000]}
```

Câu hỏi (n8n, eval): `task: search result | query: {ocr_text + query}`. Ảnh: không thêm tiền tố.

### Hàm RPC

- `match_books_text(query_embedding vector(768), query_norm text, match_count int default 10)`
- `match_books_image(query_embedding vector(768), match_count int default 10)`
- `match_books_hybrid(text_embedding vector(768), image_embedding vector(768), query_norm text, match_count int default 10, rrf_k int default 60)` — `image_embedding` null ⇒ chỉ dùng text.

Cùng trả: `image_id, title, author, publisher, supplier, image_url, product_url, description, score float`.
Boost: `similarity(title_norm, query_norm) >= 0.6` cộng vào score (text) để khớp tên OCR gần nguyên văn lên đầu.

### Bảng phụ

- `app_config(key text primary key, value text, note text)` — seed:
  `chat_model=gemini-flash-latest`, `ocr_model=gemini-flash-latest`,
  `embed_model=gemini-embedding-2`, `embed_dims=768`, `top_k=10`, `rerank_k=3`,
  `desc_max_chars=2000`, `rate_limit_per_min=10`, `rate_limit_per_day=200`.
- `rate_limits(ip text, window_start timestamptz, count int, primary key(ip, window_start))`
  + hàm `hit_rate_limit(p_ip text, p_per_min int, p_per_day int) returns boolean` (true = vượt).
- `n8n_chat_histories` — để node Postgres Chat Memory của n8n tự tạo; không tạo tay.

## n8n webhook (`https://n8n.thuanbt.id.vn/webhook/...`)

Header bắt buộc: `x-biascan-token: <token>`. CORS cho domain Vercel + `http://localhost:3000`.

### `POST /webhook/biascan-search`

Request JSON: `{ "query"?: string, "image"?: "data:image/jpeg;base64,...", "session_id": string }`
(ít nhất một trong `query`/`image`; ảnh ≤ 4 MB sau nén ở client).

Response 200:

```json
{
  "ocr_text": "string | null",
  "results": [
    { "image_id": "fahasa_1", "title": "", "author": "", "publisher": "", "supplier": "",
      "image_url": "", "product_url": "", "score": 0.83, "reason": "string | null" }
  ],
  "timings_ms": { "ocr": 0, "embed": 0, "search": 0, "rerank": 0, "total": 0 }
}
```

`results` dài `top_k`; 3 phần tử đầu là kết quả rerank của Gemini (có `reason`), phần còn lại `reason: null`.

### `POST /webhook/biascan-chat`

Request: `{ "session_id": string, "message": string, "context_ids"?: string[] }`
Response 200: `{ "reply": "markdown", "suggestions": ["câu gợi ý tiếp", ...], "products": [<card như trên, không cần score/reason>] }`

### Lỗi

`401 {"error":{"code":"unauthorized","message":"..."}}`, `429 {"error":{"code":"rate_limited",...}}`,
`400 bad_request`, `502 upstream`. Thông điệp tiếng Việt.

## Kết quả đánh giá — `web/public/eval/results.json`

```json
{
  "status": "placeholder | measured",
  "generated_at": "ISO-8601 | null",
  "n_books": 33531,
  "models": { "ocr": "", "embed": "", "rerank": "" },
  "runs": [
    { "set": "image_aug | text_query | real_photo", "mode": "text | image | hybrid",
      "n": 300, "recall_at_1": null, "recall_at_10": null, "mrr": null,
      "latency_p50_ms": null, "latency_p95_ms": null }
  ],
  "examples": [ { "set": "", "query": "", "expected_id": "", "hit_rank": null } ]
}
```

`status: placeholder` ⇒ mọi số là `null`; web phải hiển thị "chưa đo", không bịa số.

## Biến môi trường

- `ingest/.env`, `eval/.env`: `GEMINI_API_KEY`, `DATABASE_URL` (Supabase session pooler),
  `EMBED_MODEL=gemini-embedding-2`, `EMBED_DIMS=768`, `OCR_MODEL=gemini-flash-latest`,
  `N8N_BASE_URL`, `BIASCAN_TOKEN`.
- `web/.env.local`: `NEXT_PUBLIC_N8N_BASE_URL`, `NEXT_PUBLIC_BIASCAN_TOKEN`.
