# Cài đặt n8n cho BiaScan

Một workflow duy nhất `n8n/biascan.json` (tên "BiaScan") chạy toàn bộ luồng runtime trên `https://n8n.thuanbt.id.vn`, gồm 4 nhánh:

| Nhánh | Webhook / lịch | Việc |
|---|---|---|
| tìm sách | `POST /webhook/biascan-search` | token → rate limit → (ảnh: cache `img:` hoặc OCR) → cache `q:` hoặc embed → `match_books_text` / `match_books_hybrid`. Không gọi model sinh chữ khi chỉ tìm bằng chữ |
| giải thích | `POST /webhook/biascan-explain` | token → rate limit → cache `why:` hoặc 1 lần sinh lý do cho 1–3 cuốn |
| chat | `POST /webhook/biascan-chat` | token → rate limit → embed tin nhắn → `match_books_text` + sách đang xem + 6 dòng lịch sử `chat_turns` → 1 lần sinh JSON → ghi lượt chat |
| keep-alive | mỗi ngày 03:17 | `select public.keepalive(), public.purge_expired()` để Supabase free không bị pause và dọn cache |

Mọi việc sinh chữ (OCR, chat, giải thích) đi qua **chuỗi dự phòng** `app_config.llm_models` (tối đa 3 model):
node HTTP Request model 1 lỗi (429/5xx/timeout 20 s) → nhánh lỗi sang model 2 → model 3 → hết thì trả lỗi.
Không retry trong từng node để rơi sang model sau nhanh.

Yêu cầu: n8n self-hosted bản community **1.100 trở lên** (đã thử import và chạy trên 1.123.5 và 2.41.6).
Không dùng Variables (`$vars`) nên không cần bản trả phí. Trước khi làm, Supabase phải chạy xong
`supabase/schema.sql` (xem `docs/SETUP-SUPABASE.md`). DB đã chạy schema cũ thì chạy thêm
`supabase/migrations/2026-11-03-quota.sql` (thêm `search_cache`, `chat_turns`, `purge_expired()` và các khoá
`llm_models`, `chat_k`, `cache_ttl_hours`).

## 1. Thêm 2 dòng cấu hình vào `app_config`

Token so khớp ngay trong n8n: node Code **Kiểm tra token & đầu vào** đọc `app_config.biascan_token`
(qua node Postgres **Tải app_config**) rồi so với header `x-biascan-token`. Chưa có dòng này thì mọi
request đều bị trả 401. `schema.sql` không seed dòng này, bạn tự thêm trong SQL Editor của Supabase:

```sql
insert into public.app_config (key, value, note) values
  ('biascan_token', '<dán token ở đây>', 'Token header x-biascan-token cho webhook n8n'),
  ('image_search_enabled', 'false', 'true = embed thêm ảnh bìa và gọi match_books_hybrid')
on conflict (key) do update set value = excluded.value;
```

- Tạo token: `openssl rand -hex 24`. Điền cùng giá trị vào `NEXT_PUBLIC_BIASCAN_TOKEN` (web) và
  `BIASCAN_TOKEN` (eval).
- Token nằm trong bundle JS của web nên **không phải bí mật**. Nó chỉ chặn gọi bừa; lớp bảo vệ
  chính là rate limit theo IP (`rate_limit_per_min`, `rate_limit_per_day`).
- Đổi token: sửa dòng trong `app_config`, không cần sửa workflow.
- `image_search_enabled=true` chỉ bật khi đã nạp `books.image_embedding` (phase 2). Khi bật,
  ảnh được embed bằng `embed_model` và gọi `match_books_hybrid`. Nếu bước embed ảnh lỗi, workflow
  tự lùi về `match_books_text`.

Các khoá khác (`llm_models`, `embed_model`, `embed_dims`, `top_k`, `chat_k`, `cache_ttl_hours`,
`rate_limit_per_min`, `rate_limit_per_day`) đọc lại mỗi request, nên đổi model không cần sửa workflow.
`chat_model`, `ocr_model`, `rerank_k` cũ không còn được đọc.

Đổi thứ tự model dự phòng:

```sql
update public.app_config set value = 'gemini-3.5-flash-lite,gemini-3.8-flash,gemma-4-31b-it' where key = 'llm_models';
```

## 2. Tạo 2 credential

Vào **Credentials → Add credential**. Tên phải đặt **đúng như dưới đây**, vì workflow tham chiếu
credential theo tên này.

### 2.1 `Supabase BiaScan` — kiểu **Postgres**

Trùng tên với credential ở bước 5 của `docs/SETUP-SUPABASE.md`; đã tạo ở đó thì bỏ qua mục này.

Lấy ở Supabase → Project Settings → Database → Connection string → **Session pooler**:

| Ô | Giá trị |
|---|---|
| Host | `aws-0-<region>.pooler.supabase.com` |
| Database | `postgres` |
| User | `postgres.<project-ref>` |
| Password | mật khẩu database |
| Port | `5432` (session pooler; không dùng 6543) |
| SSL | `Require`. Nếu Test báo lỗi chứng chỉ (self-signed certificate), bật **Ignore SSL Issues** |
| Maximum Number of Connections | `5` (Supabase free giới hạn số kết nối pooler) |

### 2.2 `BiaScan Gemini` — kiểu **Header Auth**

Dùng cho mọi node HTTP Request gọi thẳng `generativelanguage.googleapis.com` (embed, OCR, chat, giải thích).

| Ô | Giá trị |
|---|---|
| Name | `x-goog-api-key` |
| Value | Gemini API key (AI Studio) |

Credential `BiaScan Gemini (PaLM)` (kiểu Google Gemini(PaLM) Api) của bản cũ không còn dùng vì chat đã bỏ
AI Agent; có thể giữ hoặc xoá.

## 3. Import workflow

Với mỗi file trong `n8n/`: **Workflows → Create → menu `…` → Import from File** → chọn file → **Save**.

Sau khi import, mở từng node có biểu tượng cảnh báo đỏ (nếu có) và chọn lại credential cùng tên.
File JSON chỉ chứa id giả (`biascanSupabasePg`, `biascanGeminiKey`), không có secret.

| Nhánh | Node dùng credential |
|---|---|
| tìm sách | Postgres: Tải app_config, Đếm rate limit, Tra cache ảnh, Ghi cache ảnh, Tra cache tìm, Tìm theo text, Tìm hybrid, Ghi cache tìm. Header Auth: OCR: Gemini 1/2/3, Gemini embed câu hỏi, Gemini embed ảnh |
| giải thích | Postgres: Explain: Tải app_config, Explain: Đếm rate limit, Explain: Tra cache và sách, Explain: Ghi cache. Header Auth: Explain: Gemini 1/2/3 |
| chat | Postgres: Chat: Tải app_config, Chat: Đếm rate limit, Chat: Tìm ngữ cảnh, Chat: Ghi lượt chat. Header Auth: Chat: Gemini embed, Chat: Gemini 1/2/3 |
| keep-alive | Postgres: Gọi keepalive() |

Nên import qua giao diện. Khi thử trên 1.123.5, `n8n import:workflow` (CLI) import được, nhưng
bật Active cho workflow đó (cả bằng CLI lẫn API) đều lỗi `FOREIGN KEY constraint failed`. Tạo
workflow qua giao diện (Import from File → Save) thì bật Active bình thường. Trên 2.41.6, import
bằng CLI rồi chạy `n8n publish:workflow --id=<id>` hoạt động bình thường.

## 4. Sửa CORS

Mở node **Webhook tìm sách**, **Webhook explain** và **Webhook chat** → Options → **Allowed Origins (CORS)**. Mặc định:

```
https://biascan.vercel.app,http://localhost:3000
```

Bản demo ở `https://biascan.thuanbt.id.vn` gọi webhook cùng origin qua Caddy nên không cần sửa mục này. Chỉ khi đưa web lên host khác mới thay `https://biascan.vercel.app` bằng domain đó. Các origin cách nhau bằng dấu phẩy và
**không có dấu cách**, vì n8n tách chuỗi theo `,` mà không trim. n8n tự trả lời preflight `OPTIONS`:
nó trả về đúng các header trình duyệt xin (gồm `x-biascan-token`), nên không cần node riêng cho
`OPTIONS`.

Kiểm tra preflight:

```bash
curl -i -X OPTIONS https://n8n.thuanbt.id.vn/webhook/biascan-search \
  -H 'origin: https://<domain-vercel>' \
  -H 'access-control-request-method: POST' \
  -H 'access-control-request-headers: content-type,x-biascan-token'
# cần thấy: 204, Access-Control-Allow-Origin: https://<domain-vercel>,
#           Access-Control-Allow-Headers: content-type,x-biascan-token
```

Origin không có trong danh sách sẽ nhận `Access-Control-Allow-Origin` là origin đầu tiên, nên
trình duyệt chặn. Gọi bằng curl hay server-to-server thì không bị CORS ảnh hưởng.

## 5. Kích hoạt

- n8n 1.x: bật công tắc **Active** ở workflow BiaScan.
- n8n 2.x: bấm **Publish** ở workflow BiaScan. Sau mỗi lần sửa phải Publish lại thì bản chạy thật mới
  đổi.

URL thật là `/webhook/...`. URL `/webhook-test/...` chỉ chạy khi đang bấm "Listen for test event" trong editor.

## 6. Thử bằng curl

```bash
N8N=https://n8n.thuanbt.id.vn
TOKEN=<biascan_token>

# Tìm bằng mô tả
curl -s "$N8N/webhook/biascan-search" \
  -H 'content-type: application/json' -H "x-biascan-token: $TOKEN" \
  -d '{"session_id":"curl-1","query":"sách về kỹ năng giao tiếp cho người đi làm"}'

# Tìm bằng ảnh bìa (ảnh ≤ 4 MB). Linux: base64 -w0; macOS: base64 -i bia.jpg | tr -d '\n'
IMG=$(base64 -w0 bia.jpg)
printf '{"session_id":"curl-1","image":"data:image/jpeg;base64,%s"}' "$IMG" > /tmp/biascan-req.json
curl -s "$N8N/webhook/biascan-search" \
  -H 'content-type: application/json' -H "x-biascan-token: $TOKEN" \
  --data-binary @/tmp/biascan-req.json

# Lý do khớp cho 1–3 cuốn (web gọi sau khi có kết quả tìm)
curl -s "$N8N/webhook/biascan-explain" \
  -H 'content-type: application/json' -H "x-biascan-token: $TOKEN" \
  -d '{"session_id":"curl-1","query":"sách về kỹ năng giao tiếp","image_ids":["fahasa_1","fahasa_2"]}'

# Chat
curl -s "$N8N/webhook/biascan-chat" \
  -H 'content-type: application/json' -H "x-biascan-token: $TOKEN" \
  -d '{"session_id":"curl-1","message":"Gợi ý giúp mình vài cuốn về đàm phán","context_ids":["fahasa_1"]}'
```

Kết quả mong đợi:

- search: `200 {"ocr_text": ..., "results": [...top_k], "cached": false, "timings_ms": {"ocr","embed","search","rerank","total"}}`.
  Mọi `reason: null`, `rerank` luôn 0. Gửi lại đúng câu đó lần 2 thì `cached: true` (không gọi Gemini).
- explain: `200 {"reasons": {"fahasa_1": "...", "fahasa_2": "..."}}`. Id không có trong kho bị bỏ.
- chat: `200 {"reply": "...markdown", "suggestions": [...], "products": [card...]}`.
- Lỗi: `401 unauthorized` (thiếu hoặc sai token, hoặc chưa insert `biascan_token`), `429 rate_limited`,
  `400 bad_request` (thiếu `session_id`, thiếu cả `query` lẫn `image`, ảnh > 4 MB hoặc không phải
  JPEG/PNG/WEBP/HEIC, `context_ids` không phải mảng chuỗi, `image_ids` không phải 1–3 mã, hoặc chỉ gửi ảnh mà OCR không đọc được chữ nào),
  `429 quota_exhausted` (có lần gọi Gemini trả 429 và không model nào trong chuỗi trả lời được), `502 upstream` (Gemini lỗi khác hoặc Postgres lỗi).

## 7. Lịch sử chat

Workflow tự ghi lịch sử vào bảng `public.chat_turns` (tạo sẵn trong `schema.sql` / migration, đã bật RLS).
Bảng `n8n_chat_histories` của bản cũ (AI Agent) không còn được đọc hay ghi; muốn dọn thì `drop table public.n8n_chat_histories;`.

## Ghi chú kỹ thuật

- **Embed câu hỏi**: `gemini-embedding-2` không nhận `taskType` (theo tài liệu Gemini). Workflow chỉ
  gửi `taskType: RETRIEVAL_QUERY` khi `embed_model` không bắt đầu bằng `gemini-embedding-2`.
  Văn bản đem embed là `task: search result | query: {ocr_text + query}` (tiền tố truy vấn Gemini
  khuyên dùng, khớp với tiền tố `title: … | text: …` của ingest). Model khác thì không thêm tiền tố.
  `outputDimensionality` lấy từ `embed_dims`.
- **query_norm** (dùng boost tên): lấy tên sách OCR được, nếu không có thì lấy `query`. Chuẩn hoá
  giống `ingest/textnorm.py`: đ→d, bỏ dấu, lowercase, gộp khoảng trắng.
- **Không rerank**: tìm sách trả theo thứ tự vector (+ boost tên). Lý do khớp lấy riêng qua `/biascan-explain`.
- **Chuỗi model** (`llm_models`): model Gemini gửi `responseMimeType: application/json` + `responseSchema`;
  model tên bắt đầu `gemma` không hỗ trợ JSON mode nên chỉ dặn JSON trong prompt và parse mềm (bỏ ```` ``` ````,
  bóc khối `{...}`). `thinkingConfig.thinkingLevel`: `minimal` cho `gemini-3.5-flash-lite` / `3.6-flash` /
  `3-flash` / `3.1-flash-lite`, `low` cho các Gemini 3+ khác (vd `gemini-3.8-flash` không nhận `minimal`), không gửi
  cho Gemini 2.x và Gemma. Nếu ít hơn 3 model, các node IF **còn model N?** bỏ qua node thừa.
- **429 hay 502**: node **Phân loại lỗi Gemini** của mỗi nhánh xem lỗi của mọi node Gemini đã chạy (nhánh lỗi
  `$('…').all(1)`); có 429/`RESOURCE_EXHAUSTED` thì trả `quota_exhausted`, không thì `502 upstream`.
- **Cache** (`search_cache`): đọc bằng `update … set hits = hits + 1 … returning payload` (hết hạn theo
  `cache_ttl_hours`), ghi bằng upsert **sau khi** đã trả lời web (node ghi nằm sau node Respond). Khoá ảnh là
  SHA-256 của chuỗi base64: node Code thử `require('crypto')`, nếu instance chặn module builtin thì dùng hàm
  SHA-256 viết bằng JS (ảnh 4 MB ≈ 0,2 s).
- **Chuỗi tự do vào Postgres** (tin nhắn, query, khoá cache, payload, session_id) được mã hoá
  `base64(JSON.stringify(x))` rồi giải trong SQL bằng `convert_from(decode($n, 'base64'), 'utf8')::jsonb`,
  vì Query Parameters của node Postgres tách chuỗi theo dấu phẩy và bỏ giá trị rỗng.
- **Chat**: model trả `{reply, suggestions, picks}`; `products` chỉ gồm các `picks` có trong ngữ cảnh
  (`chat_k` cuốn tìm theo tin nhắn + sách `context_ids`), nên id bịa bị bỏ. Ngữ cảnh mỗi cuốn: tên, tác giả,
  NXB, ≤ 200 ký tự mô tả. Lịch sử: 6 dòng gần nhất trong `chat_turns`.
- **timings_ms** đo bằng `Date.now()` trong các node Code quanh từng bước. `total` tính từ lúc đọc
  xong `app_config`.
- **IP** cho rate limit: `fly-client-ip` (n8n.thuanbt.id.vn chạy sau Fly proxy, header này do proxy đặt),
  nếu không có thì `cf-connecting-ip`, rồi phần tử đầu của `x-forwarded-for`, cuối cùng là `unknown`.
  Hai header sau client tự gửi được, nên chỉ tin được khi n8n nằm sau Cloudflare. Đổi nơi host thì sửa
  dòng `const ip = ...` trong node **Kiểm tra token & đầu vào** của cả 2 workflow.
- **Dữ liệu execution**: workflow tìm sách đặt *Save successful executions = Do not save* để không lưu
  ảnh base64 vào DB của n8n. Execution lỗi vẫn được lưu. Khi cần debug, mở Workflow Settings và bật lại tạm thời.
- **Thời gian chạy**: embed timeout 10 s, mỗi model trong chuỗi 20 s. Trường hợp xấu nhất (cả 3 model treo)
  là 60 s, vượt mức huỷ 30 s của web; thực tế model lỗi 429/5xx trả về ngay. Gemma đọc ảnh ~28 s nên với OCR gần
  như luôn timeout ở 20 s; đặt Gemma ở vị trí 2 chủ yếu có ích cho chat/giải thích. Nếu đặt reverse proxy trước
  n8n, cần `proxy_read_timeout` ≥ 60 s.
- **Ảnh không có chữ đọc được** (và không kèm `query`): trả `400 bad_request` kèm lời nhắc chụp lại,
  không gọi embed. Kể cả khi `image_search_enabled=true`, workflow chưa tìm bằng riêng ảnh.
- Sửa JSON bằng tay thì giữ nguyên tên node: các node Code tham chiếu nhau bằng `$('Tên node')`, các biểu
  thức dùng `$node['Tên node']`, và danh sách tên node Gemini trong node **Phân loại lỗi Gemini**.

## Lưu ý với n8n 1.123 (đã gặp khi cài thật)

- Biểu thức (không phải node Code) dùng `$node['Tên node'].json…`; `$('Tên node').first()` báo
  `#<Object> could not be cloned` trên instance này. Trong node Code thì `$('…')` vẫn chạy.
- Query Parameters của node Postgres viết dạng `{{ a }},{{ b }}` (không dùng `{{ [a, b] }}`). Mỗi `{{ }}` nếu ra
  chuỗi JSON hợp lệ (vd vector `[0.1,…]`) thì giữ nguyên là 1 tham số; chuỗi khác bị tách theo dấu phẩy, chuỗi
  rỗng bị bỏ ⇒ chuỗi tự do luôn mã hoá base64.
- Tên node tránh ký tự `&`.
- `gemini-flash-latest` hay bị 503 quá tải.
