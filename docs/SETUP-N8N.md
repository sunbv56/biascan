# Cài đặt n8n cho BiaScan

Ba workflow trong `n8n/` chạy toàn bộ luồng runtime trên `https://n8n.thuanbt.id.vn`:

| File | Webhook / lịch | Việc |
|---|---|---|
| `biascan-search.json` | `POST /webhook/biascan-search` | token → rate limit → OCR bìa → embed → `match_books_text` / `match_books_hybrid` → Gemini rerank |
| `biascan-chat.json` | `POST /webhook/biascan-chat` | token → rate limit → AI Agent (Gemini + Postgres Chat Memory + tool `tim_sach`) |
| `biascan-keepalive.json` | mỗi ngày 03:17 | `select public.keepalive()` để Supabase free không bị pause |

Yêu cầu: n8n self-hosted bản community **1.100 trở lên** (đã thử import và chạy trên 1.123.5 và 2.41.6).
Không dùng Variables (`$vars`) nên không cần bản trả phí. Trước khi làm, Supabase phải chạy xong
`supabase/schema.sql` (xem `docs/SETUP-SUPABASE.md`).

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

Các khoá khác (`chat_model`, `ocr_model`, `embed_model`, `embed_dims`, `top_k`, `rerank_k`,
`rate_limit_per_min`, `rate_limit_per_day`) đọc lại mỗi request, nên đổi model không cần sửa workflow.

## 2. Tạo 3 credential

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

Dùng cho các node HTTP Request gọi thẳng `generativelanguage.googleapis.com` (OCR, embed, rerank).

| Ô | Giá trị |
|---|---|
| Name | `x-goog-api-key` |
| Value | Gemini API key (AI Studio) |

### 2.3 `BiaScan Gemini (PaLM)` — kiểu **Google Gemini(PaLM) Api**

Dùng cho node **Gemini Chat Model** của AI Agent.

| Ô | Giá trị |
|---|---|
| Host | `https://generativelanguage.googleapis.com` |
| API Key | cùng Gemini API key |

## 3. Import 3 workflow

Với mỗi file trong `n8n/`: **Workflows → Create → menu `…` → Import from File** → chọn file → **Save**.

Sau khi import, mở từng node có biểu tượng cảnh báo đỏ (nếu có) và chọn lại credential cùng tên.
File JSON chỉ chứa id giả (`biascanSupabasePg`, `biascanGeminiKey`, `biascanGeminiPalm`), không có secret.

| Workflow | Node dùng credential |
|---|---|
| tìm sách | Postgres: Tải app_config, Đếm rate limit, Tìm theo text, Tìm hybrid. Header Auth: Gemini OCR bìa, Gemini embed câu hỏi, Gemini embed ảnh, Gemini rerank |
| chat tư vấn | Postgres: Tải app_config, Đếm rate limit, Sách đang xem, Lấy thẻ sách, Tool: tải app_config, Tool: match_books_text, Postgres Chat Memory. Header Auth: Tool: Gemini embed. PaLM: Gemini Chat Model |
| keep-alive | Postgres: Gọi keepalive() |

Nên import qua giao diện. Khi thử trên 1.123.5, `n8n import:workflow` (CLI) import được, nhưng
bật Active cho workflow đó (cả bằng CLI lẫn API) đều lỗi `FOREIGN KEY constraint failed`. Tạo
workflow qua giao diện (Import from File → Save) thì bật Active bình thường. Trên 2.41.6, import
bằng CLI rồi chạy `n8n publish:workflow --id=<id>` hoạt động bình thường.

## 4. Sửa CORS

Mở node **Webhook tìm sách** và **Webhook chat** → Options → **Allowed Origins (CORS)**. Mặc định:

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

- n8n 1.x: bật công tắc **Active** ở cả 3 workflow.
- n8n 2.x: bấm **Publish** ở cả 3 workflow. Sau mỗi lần sửa phải Publish lại thì bản chạy thật mới
  đổi.

URL thật là `/webhook/...`. URL `/webhook-test/...` chỉ chạy khi đang bấm "Listen for test event" trong editor.

Tool `tim_sach` của workflow chat gọi lại **chính workflow đó** (`{{ $workflow.id }}`), vào nhánh
dưới bắt đầu bằng node **Khi agent gọi tim_sach**. Vì vậy workflow chat phải được lưu và kích hoạt
thì tool mới chạy. Không cần chọn lại workflow id sau khi import.

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

# Chat
curl -s "$N8N/webhook/biascan-chat" \
  -H 'content-type: application/json' -H "x-biascan-token: $TOKEN" \
  -d '{"session_id":"curl-1","message":"Gợi ý giúp mình vài cuốn về đàm phán","context_ids":["fahasa_1"]}'
```

Kết quả mong đợi:

- search: `200 {"ocr_text": ..., "results": [...top_k], "timings_ms": {"ocr","embed","search","rerank","total"}}`.
  `rerank_k` phần tử đầu có `reason`, các phần tử sau có `reason: null`.
- chat: `200 {"reply": "...markdown", "suggestions": [...], "products": [card...]}`.
- Lỗi: `401 unauthorized` (thiếu hoặc sai token, hoặc chưa insert `biascan_token`), `429 rate_limited`,
  `400 bad_request` (thiếu `session_id`, thiếu cả `query` lẫn `image`, ảnh > 4 MB hoặc không phải
  JPEG/PNG/WEBP/HEIC, `context_ids` không phải mảng chuỗi, hoặc chỉ gửi ảnh mà OCR không đọc được chữ nào), `502 upstream` (Gemini hoặc Postgres lỗi).

## 7. Sau lần chat đầu tiên: bật RLS cho `n8n_chat_histories`

`supabase/schema.sql` đã thu hồi quyền mặc định của `anon`/`authenticated` trên bảng mới trong `public`,
nên bước này chỉ để chắc chắn. Node Postgres Chat Memory tự tạo bảng `public.n8n_chat_histories` ở lần chat đầu. Supabase mặc định
cấp quyền bảng mới trong `public` cho `anon`, nên khoá anon có thể đọc lịch sử chat qua REST API.
Chạy một lần sau khi bảng xuất hiện:

```sql
alter table public.n8n_chat_histories enable row level security;
```

n8n kết nối bằng role `postgres`, là chủ bảng nên vẫn đọc/ghi bình thường.

## Ghi chú kỹ thuật

- **Embed câu hỏi**: `gemini-embedding-2` không nhận `taskType` (theo tài liệu Gemini). Workflow chỉ
  gửi `taskType: RETRIEVAL_QUERY` khi `embed_model` không bắt đầu bằng `gemini-embedding-2`.
  Văn bản đem embed là `task: search result | query: {ocr_text + query}` (tiền tố truy vấn Gemini
  khuyên dùng, khớp với tiền tố `title: … | text: …` của ingest). Model khác thì không thêm tiền tố.
  `outputDimensionality` lấy từ `embed_dims`.
- **query_norm** (dùng boost tên): lấy tên sách OCR được, nếu không có thì lấy `query`. Chuẩn hoá
  giống `ingest/textnorm.py`: đ→d, bỏ dấu, lowercase, gộp khoảng trắng.
- **Rerank** dùng `chat_model` ở chế độ JSON (`responseSchema`). Nếu rerank lỗi hoặc trả JSON hỏng,
  vẫn trả 200 theo thứ tự vector và mọi `reason` là `null`. Chỉ id có trong danh sách ứng viên mới được nhận.
- **Chat**: agent trả `{reply, suggestions, products[{image_id,title}]}` qua Structured Output Parser.
  Thẻ sách trong `products` được lấy lại từ bảng `books` theo `image_id`, nên id hoặc link bịa sẽ bị
  bỏ. Memory giữ 10 lượt gần nhất theo `session_id`.
- **timings_ms** đo bằng `Date.now()` trong các node Code quanh từng bước. `total` tính từ lúc đọc
  xong `app_config`.
- **IP** cho rate limit: `fly-client-ip` (n8n.thuanbt.id.vn chạy sau Fly proxy, header này do proxy đặt),
  nếu không có thì `cf-connecting-ip`, rồi phần tử đầu của `x-forwarded-for`, cuối cùng là `unknown`.
  Hai header sau client tự gửi được, nên chỉ tin được khi n8n nằm sau Cloudflare. Đổi nơi host thì sửa
  dòng `const ip = ...` trong node **Kiểm tra token & đầu vào** của cả 2 workflow.
- **Dữ liệu execution**: workflow tìm sách đặt *Save successful executions = Do not save* để không lưu
  ảnh base64 vào DB của n8n. Execution lỗi vẫn được lưu. Khi cần debug, mở Workflow Settings và bật lại tạm thời.
- **Thời gian chạy**: OCR → embed → search → rerank chạy tuần tự, thường vài giây. Web tự huỷ request ở
  30 s, nên timeout từng bước đặt là OCR 15 s, embed 10 s, rerank 10 s (rerank quá hạn thì trả theo thứ tự
  vector, không lỗi). Nếu đặt reverse proxy trước n8n, cần `proxy_read_timeout` ≥ 60 s.
- **Ảnh không có chữ đọc được** (và không kèm `query`): trả `400 bad_request` kèm lời nhắc chụp lại,
  không gọi embed. Kể cả khi `image_search_enabled=true`, workflow chưa tìm bằng riêng ảnh.
- Sửa JSON bằng tay thì giữ nguyên tên node: các node Code tham chiếu nhau bằng `$('Tên node')`.
