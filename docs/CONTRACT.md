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
  `llm_models=gemini-3.5-flash-lite,gemma-4-31b-it,gemini-3.8-flash` (thứ tự dự phòng cho mọi việc
  sinh chữ: OCR, chat, giải thích; model đầu lỗi 429/5xx/timeout thì thử model sau),
  `embed_model=gemini-embedding-2`, `embed_dims=768`, `top_k=10`, `chat_k=5`,
  `desc_max_chars=2000`, `rate_limit_per_min=10`, `rate_limit_per_day=200`,
  `cache_ttl_hours=168`. (`chat_model`, `ocr_model`, `rerank_k` cũ không còn dùng.)
- `search_cache(cache_key text primary key, payload jsonb, hits int default 0, created_at timestamptz default now())`
  — `q:<chuẩn hoá(ocr_text + query)>` → `{results}` (chữ dài > 300 ký tự thì khoá là 200 ký tự đầu + băm);
  `img:<sha256 hex của chuỗi base64 ảnh>` → `{ocr_text, ocr_title}` (OCR rỗng không cache);
  `why:<chuẩn hoá(query)>|<image_ids sắp xếp, nối bằng |>` → `{reasons}`. Hết hạn theo `cache_ttl_hours`
  (n8n lọc theo `created_at`; `purge_expired()` xoá hằng ngày). Tìm hybrid (`image_search_enabled=true`) không cache `q:`.
  "Chuẩn hoá" = như `title_norm` và bỏ dấu câu.
- `rate_limits(ip text, window_start timestamptz, count int, primary key(ip, window_start))`
  + hàm `hit_rate_limit(p_ip text, p_per_min int, p_per_day int) returns boolean` (true = vượt).
- `chat_turns(id bigint identity primary key, session_id text, role text check in ('user','assistant'), content text, created_at timestamptz default now())`
  — lịch sử chat do workflow tự ghi (mỗi lượt 2 dòng); index `(session_id, id desc)`. Không dùng `n8n_chat_histories` nữa.
- `purge_expired() returns int` — xoá `search_cache` quá `cache_ttl_hours` và `chat_turns` cũ hơn 30 ngày; workflow keep-alive gọi hằng ngày.

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

`results` dài `top_k`, xếp theo vector (+ boost tên), **không gọi model sinh chữ**; mọi `reason: null`.
Thêm `"cached": boolean`. `timings_ms.rerank` luôn 0.

### `POST /webhook/biascan-explain`

Request: `{ "session_id": string, "query": string, "image_ids": string[] }` (1–3 id, `query` là câu
tìm hoặc chữ OCR). Response 200: `{ "reasons": { "<image_id>": "1 câu ≤ 160 ký tự" } }`.
Đúng 1 lần gọi model (chuỗi dự phòng `llm_models`), có cache.

### `POST /webhook/biascan-chat`

Request: `{ "session_id": string, "message": string, "context_ids"?: string[] }`
Luồng cố định, **1 lần gọi model**: embed `message` → `match_books_text` lấy `chat_k` cuốn + sách trong
`context_ids` → 1 lần sinh JSON `{reply, suggestions, picks}` (chuỗi dự phòng) → `products` = các cuốn
trong `picks` (chỉ id có trong ngữ cảnh, tối đa 4). Lịch sử: 6 dòng gần nhất trong `chat_turns` theo `session_id`
(= 3 cặp hỏi–đáp); ghi 2 dòng mới sau khi trả lời.
Response 200: `{ "reply": "markdown", "suggestions": ["câu gợi ý tiếp", ...], "products": [<card như trên, không cần score/reason>] }`

### Lỗi

`401 {"error":{"code":"unauthorized","message":"..."}}`, `429 {"error":{"code":"rate_limited",...}}`,
`429 quota_exhausted` (mọi model trong chuỗi / embedding hết quota Gemini: "Demo đã dùng hết lượt miễn
phí hôm nay, vui lòng thử lại sau 15:00 (giờ Việt Nam)."), `400 bad_request`, `502 upstream`.
Quy tắc: request thất bại mà có ít nhất một lần gọi Gemini trả 429 (embed hoặc bất kỳ model nào trong chuỗi) ⇒
`quota_exhausted`; thất bại vì lỗi khác (5xx, timeout, DB) ⇒ `502 upstream`.
Thông điệp tiếng Việt.

## Kết quả đánh giá — `web/public/eval/results.json`

```json
{
  "status": "placeholder | measured",
  "generated_at": "ISO-8601 | null",
  "n_books": 950,
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
  `EMBED_MODEL=gemini-embedding-2`, `EMBED_DIMS=768`, `OCR_MODEL=gemini-2.5-flash`,
  `N8N_BASE_URL`, `BIASCAN_TOKEN`.
- `web/.env.local`: `NEXT_PUBLIC_N8N_BASE_URL`, `NEXT_PUBLIC_BIASCAN_TOKEN`.

## Kho sách

Cố định **950 sách** `fahasa_0` … `fahasa_949`, công bố ở
<https://huggingface.co/datasets/sunbv56/biascan-950> (kèm `text_embedding`). Không nạp thêm.
