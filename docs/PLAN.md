# BiaScan — kế hoạch đã chốt (03/11/2026)

Tra cứu sách bằng ảnh chụp bìa hoặc mô tả tự nhiên, kèm chat tư vấn. Mục tiêu: dự án portfolio
chứng minh năng lực AI/LLM engineering bằng số đo thật, chạy demo được.

## Dữ liệu

- `sunbv56/vi-OCR_VQA-desc` (HF), 33.531 sách Fahasa: `image_id, title, author, publisher,
  supplier, description, og_description, product_url, image_url, conversations`.
- Mô tả: trung vị 925 ký tự, max 34.352, 564 dòng rỗng → cắt **2.000 ký tự đầu**.

## Kiến trúc

```
Next.js tĩnh (Caddy trên Fly, biascan.thuanbt.id.vn) ──POST──▶ n8n (webhook, token header, rate limit theo IP)
                              │
   ảnh ─▶ Gemini Flash OCR ─▶ text ─┐
   lời  ───────────────────────────┤─▶ gemini-embedding-2 (768d) ─▶ Supabase pgvector top-10
                                   │        + boost khớp tên không dấu
                                   └─▶ Gemini rerank top-3 + lý do ─▶ Gemini chat trả lời + gợi ý
```

- Luồng runtime **chỉ chạy trên n8n** `n8n.thuanbt.id.vn`. Không backend riêng.
- Ingest 33,5k sách: **script Python** một lần, idempotent theo `image_id`.
- Văn bản embed: `title + author + publisher + supplier + description[:2000]`.
- Ảnh bìa (Q14): probe 100 ảnh đo token/ảnh + quota free. Nạp hết ≤3 ngày bằng free → làm,
  gộp với text bằng RRF; không thì để phase 2. Schema giữ sẵn cột `image_embedding`.
- Chat memory: Postgres Chat Memory của n8n → Supabase.

## Cấu hình (đổi model không sửa code)

| Nơi | Chứa |
|---|---|
| Bảng `app_config` (Supabase) | model chat, OCR, embedding, dims, top_k, rerank_k, desc_max_chars, rate limit |
| n8n Credentials | Gemini API key, Postgres Supabase |
| `.env` (`ingest/`, `eval/`) | key, DB URL, tên model (mặc định khớp `app_config`) |
| `web/.env.local` | URL webhook + token công khai |

## Bảo vệ & vận hành

- Header `x-biascan-token` + rate limit theo IP (bảng `rate_limits`).
- Workflow keep-alive hằng ngày để Supabase free không bị pause sau 7 ngày.
- Chi phí mục tiêu: 0đ (free tier Gemini, Supabase free, web tĩnh trên proxy Fly sẵn có).

## Đánh giá (`eval/`, trang `/eval`)

- 300 ảnh bìa bị biến dạng (xoay, crop, blur, sáng tối — giả ảnh điện thoại).
- 100 truy vấn "sách về…" do Gemini viết, cấm chứa tên sách.
- ~20 ảnh tự chụp thật.
- Chỉ số: Recall@1, Recall@10, MRR, latency p50/p95; cột so sánh text / ảnh / hybrid.

## Giao diện (`web/`)

Next.js + Tailwind + GSAP, làm mới hoàn toàn theo Hallmark. Trang: landing, tìm kiếm (upload +
ô mô tả + thẻ sản phẩm), drawer chat, `/eval`. Không admin, không lead form.

## Repo

`github.com/sunbv56/biascan` (public): `web/ ingest/ eval/ n8n/ supabase/ docs/`.

## Việc user phải tự làm

1. Tạo project Supabase (xem `docs/SETUP-SUPABASE.md`), chạy `supabase/schema.sql`.
2. Tạo credential trong n8n, import `n8n/*.json`.
3. Điền `.env`. Build web tĩnh, deploy lên proxy Fly (`web/README.md`).
