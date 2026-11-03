# BiaScan

Tra cứu sách bằng **ảnh chụp bìa** hoặc **lời mô tả tự nhiên**, kèm chat tư vấn — trên 33.531 đầu sách
Fahasa (dataset [`sunbv56/vi-OCR_VQA-desc`](https://huggingface.co/datasets/sunbv56/vi-OCR_VQA-desc)).

```
Next.js (Vercel) ──▶ n8n webhook (token + rate limit theo IP)
   ảnh ─▶ Gemini Flash OCR ─┐
   lời  ────────────────────┼─▶ gemini-embedding-2 (768d) ─▶ Supabase pgvector top-10 (+ khớp tên bỏ dấu)
                            └─▶ Gemini rerank top-3 kèm lý do ─▶ Gemini chat tư vấn
```

## Điểm kỹ thuật

- **Retrieval lai:** HNSW cosine trên embedding văn bản, cộng điểm khi tên sách OCR khớp gần đúng
  (trigram trên tên đã bỏ dấu); RRF gộp thêm embedding ảnh bìa khi bật (`match_books_hybrid`).
- **Đánh giá có phương pháp** (`eval/`): 300 bìa bị làm hỏng giả ảnh điện thoại, 100 câu nhu cầu cấm
  chứa tên sách/tác giả, ảnh chụp thật; đo Recall@1/@10, MRR, latency p50/p95, so text / ảnh / hybrid.
  Kết quả hiển thị ở trang `/eval` — chưa đo thì ghi "chưa đo", không có số dựng sẵn.
- **Pipeline nạp dữ liệu idempotent** (`ingest/`): batch, resume, backoff theo `retryDelay`, giới hạn RPM.
- **Đổi model không sửa code:** bảng `app_config` (chat / OCR / embedding / top_k / rate limit).
- **Chi phí 0đ:** free tier Gemini, Supabase, Vercel; n8n tự host.

## Cấu trúc

| Thư mục | Nội dung |
|---|---|
| `supabase/` | `schema.sql` — bảng, index, hàm tìm kiếm, rate limit |
| `ingest/` | Script Python nạp + embed sách, probe chi phí embedding ảnh |
| `n8n/` | Workflow tìm kiếm, chat, keep-alive (import JSON) |
| `eval/` | Tạo bộ đánh giá, chạy đo, ghi `web/public/eval/results.json` |
| `web/` | Giao diện Next.js + Tailwind + GSAP |
| `docs/` | `PLAN.md`, `CONTRACT.md`, `SETUP-SUPABASE.md`, `SETUP-N8N.md` |

## Chạy

1. [`docs/SETUP-SUPABASE.md`](docs/SETUP-SUPABASE.md) — tạo project, chạy `supabase/schema.sql`.
2. [`ingest/README.md`](ingest/README.md) — nạp dữ liệu.
3. [`docs/SETUP-N8N.md`](docs/SETUP-N8N.md) — import workflow, tạo credential.
4. [`web/README.md`](web/README.md) — chạy local / deploy Vercel.
5. [`eval/README.md`](eval/README.md) — đo và cập nhật trang `/eval`.

Dữ liệu sách thuộc Fahasa, dùng cho mục đích minh hoạ; dự án không liên kết với Fahasa.
