# ingest/ — nạp sách vào Supabase

Script Python chạy một lần để nạp 33.531 sách Fahasa từ HF dataset
[`sunbv56/vi-OCR_VQA-desc`](https://huggingface.co/datasets/sunbv56/vi-OCR_VQA-desc) vào bảng
`books` (xem `docs/CONTRACT.md`). Ghi theo `image_id`, chạy lại bao nhiêu lần cũng được: dòng nào đã
có `text_embedding` cùng `embed_model` thì bỏ qua, nên chết giữa chừng chỉ cần chạy lại lệnh cũ.

| File | Việc |
|---|---|
| `ingest.py` | Tải dataset, ghép văn bản embed, gọi `gemini-embedding-2` (768 chiều), upsert `books` |
| `probe_images.py` | Thử 100 ảnh bìa: token/ảnh, thời gian, số lần 429 → ước tính cho cả 33.531 ảnh |
| `embed_images.py` | Phase 2: nạp `image_embedding` cho mọi sách đã có `text_embedding` |
| `textnorm.py` | `normalize()` cho `title_norm` + mẫu văn bản embed (dùng chung) |

## 1. Cài đặt

Đã thử với Python 3.14 (mọi thư viện có wheel). Nếu máy khác lỗi cài đặt, dùng Python 3.12.

```bash
cd ingest
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # điền GEMINI_API_KEY và DATABASE_URL
```

`DATABASE_URL` lấy ở Supabase → Connect → **Session pooler** (cổng 5432). Bảng `books` phải tạo
trước bằng `supabase/schema.sql`.

## 2. Chạy thử

```bash
.venv/bin/python ingest.py --dry-run              # không gọi API/DB: in 3 văn bản embed mẫu + thống kê
.venv/bin/python ingest.py --limit 50 --rpm 30    # embed và ghi 50 sách đầu
```

Kiểm tra trên Supabase SQL editor:

```sql
select image_id, title_norm, embed_model, vector_dims(text_embedding) from books limit 5;
```

## 3. Chạy toàn bộ

```bash
.venv/bin/python ingest.py --rpm 60
```

Các cờ chính:

| Cờ | Mặc định | Ý nghĩa |
|---|---|---|
| `--batch` | 100 | văn bản mỗi request (`batchEmbedContents` nhận tối đa 100) |
| `--rpm` | 60 | trần request/phút phía client; `0` = không giới hạn |
| `--count-items` | tắt | tính mỗi văn bản là 1 đơn vị RPM — bật nếu quota tính theo input chứ không theo request |
| `--max-retries` | 8 | thử lại khi 429/5xx/lỗi mạng, backoff mũ, tôn trọng `retryDelay` của API |
| `--force` | tắt | embed lại cả dòng đã có |
| `--limit` | — | chỉ xử lý N sách đầu |

Hết quota trong ngày (429 có `PerDay`) → script dừng, giữ những batch đã ghi, thoát mã 2. Chạy lại
sau khi quota reset (nửa đêm giờ Pacific).

### Ước tính thời gian (văn bản)

33.531 sách / 100 mỗi batch = **336 request**. Văn bản trung vị ~1.050 ký tự, dài nhất ~2.350.

- Nếu free tier đếm quota **theo request**: 336 request ở `--rpm 60` ≈ 6 phút (+ thời gian API).
- Nếu đếm **theo từng văn bản** (`--count-items`): bị chặn bởi RPM/RPD của model. Ví dụ 100 RPM và
  1.000 RPD thì cần ~34 ngày — khi đó nên bật billing (giá văn bản $0,20/1M token, cả bộ ~10–15M
  token ≈ $2–3) hoặc chấp nhận chạy nhiều ngày.

Hạn mức free tier thật của project xem ở <https://aistudio.google.com/rate-limit>. Chạy `--limit 500`
trước, nếu thấy log "thử lại … 429" liên tục thì hạ `--rpm` hoặc bật `--count-items`.

## 4. Probe ảnh bìa

```bash
.venv/bin/python probe_images.py --dry-run          # chỉ tải 100 ảnh, kiểm URL
.venv/bin/python probe_images.py --rpm 30 --rpd 1000
.venv/bin/python probe_images.py --write-db         # ghi luôn image_embedding cho 100 ảnh đó
```

Mẫu chọn bằng `--seed 42` (cố định). Kết quả + ước tính token/chi phí/số ngày cho 33.531 ảnh ghi ra
`ingest/out/probe.json` (không commit). Truyền `--rpd` đúng hạn mức trong AI Studio để ước tính sát.
Số token/ảnh lấy từ `embeddings[].statistics.token_count` nếu API trả về, không thì gọi
`models.count_tokens`; không đo được thì để `null`. Bảng giá tham chiếu: ảnh $0,45/1M token,
tức ~$0,00012/ảnh (~$4 cho cả bộ nếu trả phí).

Ảnh GIF/WebP được đổi sang JPEG trước khi gửi (API chỉ nhận PNG/JPEG). Ảnh 404 được ghi lỗi, không
làm dừng script.

## 5. Phase 2 — embed toàn bộ ảnh

Chỉ chạy khi probe cho thấy nạp hết được trong ≤ 3 ngày free.

```bash
.venv/bin/python embed_images.py --limit 50     # thử
.venv/bin/python embed_images.py --rpm 60       # toàn bộ, chạy lại để resume
```

Chỉ xử lý sách đã có `text_embedding` cùng `embed_model` (cột `embed_model` dùng chung cho cả hai
vector). Mỗi request tối đa 6 ảnh (`--batch` ≤ 6, giới hạn của `gemini-embedding-2`). Ảnh tải lỗi hoặc bị API từ chối (4xx) ghi vào `ingest/out/image_failures.jsonl`, không làm dừng script, và sẽ được thử lại ở lần chạy sau.
Nếu đổi `EMBED_MODEL` rồi chạy `ingest.py`, `image_embedding` cũ bị xoá về `NULL` để không trộn hai
không gian vector.

## Ghi chú kỹ thuật

- `gemini-embedding-2` **không nhận `task_type`** (tài liệu ai.google.dev/gemini-api/docs/embeddings);
  script chỉ gửi `task_type=RETRIEVAL_DOCUMENT` khi `EMBED_MODEL` là model cũ như
  `gemini-embedding-001`.
- Mỗi văn bản/ảnh được bọc trong một `Content` riêng để nhận một embedding riêng — truyền list chuỗi
  trần cho `gemini-embedding-2` sẽ bị gộp thành một embedding.
- `gemini-embedding-2` tự chuẩn hoá vector khi cắt chiều; script vẫn chuẩn hoá L2 lại (vô hại, và cần
  cho `gemini-embedding-001`).
- `description` lưu vào DB là bản đã cắt 2.000 ký tự, lấy `og_description` khi `description` rỗng
  (524 sách không có cả hai).
