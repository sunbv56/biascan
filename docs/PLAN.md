# BiaScan — kế hoạch đã chốt (03/11/2026)

Tra cứu sách bằng ảnh chụp bìa hoặc mô tả tự nhiên, kèm chat tư vấn. Mục tiêu: dự án portfolio
chứng minh năng lực AI/LLM engineering bằng số đo thật, chạy demo được.

## Dữ liệu

- Kho **cố định 950 sách** = 950 sản phẩm khác nhau đầu tiên của `sunbv56/vi-OCR_VQA-desc` (HF):
  `image_id, title, author, publisher, supplier, description, og_description, product_url, image_url, conversations`.
  Không nạp thêm.
- Dataset gốc lặp lại cùng sản phẩm dưới nhiều `image_id` (12.661 / 33.531 dòng thừa; 950 dòng đầu chỉ có 741 sản phẩm).
  Chốt 04/11/2026: bỏ trùng theo link sản phẩm (bỏ query string), giữ lần xuất hiện đầu → kho = 741 cuốn cũ + 209 cuốn
  tiếp theo (`fahasa_0` … `fahasa_1187`, không liền mạch). DB có unique index theo link sản phẩm; eval lấy kho từ
  dataset `biascan-950` thay vì dải id.
- Công bố lại kèm `embed_text` + `text_embedding` ở
  [`sunbv56/biascan-950`](https://huggingface.co/datasets/sunbv56/biascan-950).
- Thống kê: 933 cuốn có mô tả (trung vị 915 ký tự, dài nhất 13.907) → cắt **2.000 ký tự đầu**; 661 tác giả, 71 NXB.

## Kiến trúc

```
Next.js tĩnh (Caddy trên Fly, biascan.thuanbt.id.vn) ──POST──▶ n8n (webhook, token header, rate limit theo IP)
                              │
   ảnh ─▶ [cache img:] ─▶ OCR (chuỗi llm_models) ─▶ text ─┐
   lời  ─────────────────────────────────────────────────┤─▶ [cache q:] ─▶ gemini-embedding-2 (768d)
                                                          │      ─▶ Supabase pgvector top-10 + boost tên
   /biascan-explain: [cache why:] ─▶ 1 lần sinh lý do 1–3 cuốn (chuỗi llm_models)
   /biascan-chat: embed tin nhắn ─▶ top chat_k + sách đang xem + lịch sử chat_turns ─▶ 1 lần sinh JSON
```

- Luồng runtime **chỉ chạy trên n8n** `n8n.thuanbt.id.vn`. Không backend riêng.
- Ingest 950 sách: **script Python** một lần, idempotent theo `image_id`.
- Văn bản embed: `title + author + publisher + supplier + description[:2000]`.
- Ảnh bìa (Q14): probe 100 ảnh đo token/ảnh + quota free. Nạp hết ≤3 ngày bằng free → làm,
  gộp với text bằng RRF; không thì để phase 2. Schema giữ sẵn cột `image_embedding`.
- Lịch sử chat: bảng `chat_turns` (workflow tự ghi). Giữ Gemini free tier: cache `search_cache`, không rerank,
  chuỗi model dự phòng khi 429/5xx (xem `docs/CONTRACT.md`).

## Cấu hình (đổi model không sửa code)

| Nơi | Chứa |
|---|---|
| Bảng `app_config` (Supabase) | chuỗi model `llm_models`, embedding, dims, top_k, chat_k, cache_ttl_hours, desc_max_chars, rate limit |
| n8n Credentials | Gemini API key, Postgres Supabase |
| `.env` (`ingest/`, `eval/`) | key, DB URL, tên model (mặc định khớp `app_config`) |
| `web/.env.local` | URL webhook + token công khai |

## Tối ưu quota Gemini free

- Tìm kiếm không gọi model sinh chữ (bỏ rerank); lý do chỉ viết khi người dùng bấm “Vì sao?” — 1 lần gọi cho 3 cuốn.
- Chat: đúng 1 lần gọi model mỗi lượt.
- Cache `search_cache`: câu hỏi → kết quả, ảnh (sha256) → chữ OCR, câu hỏi + id → lý do; hết hạn theo `cache_ttl_hours`.
- Chuỗi dự phòng `llm_models`: model đầu lỗi 429/5xx/timeout thì thử model sau; hết cả chuỗi → `429 quota_exhausted`
  với thông điệp thân thiện (web hiện nguyên văn, phân biệt với `rate_limited`).
- Ảnh nén ở trình duyệt: cạnh dài ≤ 768 px, JPEG q≈0,8 → ít token ảnh hơn.

## Bảo vệ & vận hành

- Header `x-biascan-token` + rate limit theo IP (bảng `rate_limits`).
- Workflow keep-alive hằng ngày để Supabase free không bị pause sau 7 ngày.
- Chi phí mục tiêu: 0đ (free tier Gemini, Supabase free, web tĩnh trên proxy Fly sẵn có).

## Đánh giá (`eval/`, trang `/eval`)

Mọi bộ chỉ lấy sách trong kho 950 cuốn (danh sách id lấy từ dataset `biascan-950`).

- 100 ảnh bìa bị biến dạng (xoay, crop, blur, sáng tối — giả ảnh điện thoại).
- 100 truy vấn "sách về…" do Gemini viết, cấm chứa tên sách.
- ~20 ảnh tự chụp thật (sách có trong kho).
- Chỉ số: Recall@1, Recall@10, MRR, latency p50/p95; cột so sánh text / ảnh / hybrid.

## Giao diện (`web/`)

Next.js + Tailwind + GSAP, làm mới hoàn toàn theo Hallmark. Không admin, không lead form.

Chỉ 2 tab (chốt 04/11/2026):

- **Tìm sách** (`/`, bỏ landing và `/tim-kiem`): một khung hội thoại. Dòng thời gian xen kẽ khối kết quả tìm
  (3 cuốn khớp nhất + “Vì sao?” + 7 cuốn gần giống) và câu trả lời trợ lý. Một ô nhập chung: đính kèm ảnh
  (chụp/chọn/kéo thả) + chữ. Có ảnh hoặc chưa có kết quả → tìm; đã có kết quả mà chỉ có chữ → hỏi trợ lý
  (dựa trên kết quả gần nhất); công tắc “Tìm mới / Hỏi tiếp” để đổi tay. Câu/ảnh mẫu ở trạng thái trống,
  sau đó là câu hỏi gợi ý. Lịch sử giữ trong phiên; nút “Cuộc hội thoại mới” xoá dòng thời gian và đổi
  `session_id` (trợ lý quên lịch sử chat cũ).
  Bố cục (chốt 04/11/2026, bớt cuộn): máy tính chia đôi — trái là hội thoại gọn (mỗi lượt tìm chỉ một dòng tóm tắt,
  bấm để chọn) + ô nhập, phải là bảng kết quả của lượt đang chọn; khung cao đúng màn hình, hai cột cuộn riêng.
  Kết quả gọn: 3 cuốn đầu xếp 3 cột, 7 cuốn gần giống là lưới bìa nhỏ (7 cột khi đủ chỗ, 4 + 3 khi
  hẹp, không cuộn ngang), thời gian xử lý một dòng.
  Điện thoại: một cột, chỉ lượt tìm đang chọn (mặc định lượt mới nhất) bung kết quả, lượt cũ thu một dòng.
- **Đo lường** (`/eval`): bảng số + sơ đồ luồng xử lý + thông số kho (chuyển từ landing cũ).
- Bỏ drawer chat và nút “Hỏi trợ lý” trên header.

## Repo

`github.com/sunbv56/biascan` (public): `web/ ingest/ eval/ n8n/ supabase/ docs/`.

## Việc user phải tự làm

1. Tạo project Supabase (xem `docs/SETUP-SUPABASE.md`), chạy `supabase/schema.sql`.
2. Tạo credential trong n8n, import `n8n/*.json`.
3. Điền `.env`. Build web tĩnh, deploy lên proxy Fly (`web/README.md`).
