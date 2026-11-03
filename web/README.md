# BiaScan — web

Giao diện Next.js (App Router) cho BiaScan: tìm sách bằng ảnh bìa hoặc mô tả, drawer chat tư vấn, trang `/eval`.
Web không có backend riêng — mọi lời gọi đi thẳng tới webhook n8n theo `docs/CONTRACT.md`.

| Trang | Nội dung |
|---|---|
| `/` | Giới thiệu, sơ đồ luồng OCR → embedding → pgvector → rerank |
| `/tim-kiem` | Chụp/tải ảnh bìa (nén ở trình duyệt), ô mô tả, top 3 kèm lý do + 7 kết quả gọn |
| `/eval` | Đọc `public/eval/results.json`; `status: "placeholder"` ⇒ hiện "chưa đo", không có số |
| Drawer chat | Mở từ nút "Hỏi trợ lý" ở mọi trang; gửi `context_ids` = kết quả tìm gần nhất |

Stack: Next.js 16, React 19, TypeScript, Tailwind CSS v4, GSAP 3 (`@gsap/react`), `react-markdown` (không render HTML thô).

## Biến môi trường

Sao chép `.env.example` thành `.env.local`:

| Biến | Ý nghĩa |
|---|---|
| `NEXT_PUBLIC_N8N_BASE_URL` | URL gốc n8n, không có `/` cuối, vd `https://n8n.thuanbt.id.vn` |
| `NEXT_PUBLIC_BIASCAN_TOKEN` | Token gửi trong header `x-biascan-token` |

Hai biến đều được nhúng vào bundle phía trình duyệt lúc build — token là công khai, chỉ để chặn gọi bừa; chống lạm dụng
dựa vào rate limit theo IP ở n8n. Đổi biến thì phải build lại.

## Chạy local

Cần Node ≥ 20.

```bash
cd web
npm install
cp .env.example .env.local   # điền URL + token
npm run dev                   # http://localhost:3000
```

Kiểm tra trước khi đẩy:

```bash
npm run typecheck
npm run lint
NODE_OPTIONS=--max-old-space-size=4096 npm run build
```

n8n phải cho phép CORS từ `http://localhost:3000` và domain Vercel.

> Ổ NTFS (fuseblk): `next dev/build` trên ổ này hay lỗi ChunkLoadError/symlink. Khi đó sao chép thư mục sang ổ ext4
> (vd `rsync -a --exclude node_modules --exclude .next web/ ~/.cache/biascan-run/web/`) rồi cài và chạy ở đó.

## Deploy Vercel

1. Import repo, đặt **Root Directory** = `web`. Framework preset: Next.js (tự nhận).
2. Thêm `NEXT_PUBLIC_N8N_BASE_URL` và `NEXT_PUBLIC_BIASCAN_TOKEN` cho Production (và Preview nếu cần).
3. Thêm domain Vercel vào danh sách CORS của webhook n8n.
4. Ảnh bìa từ `cdn0.fahasa.com` đi qua `next/image` (khai báo ở `next.config.ts`); ảnh ở host khác hiện không tối ưu.

## Cập nhật số đo

Script trong `eval/` ghi đè `web/public/eval/results.json` (đúng schema trong CONTRACT, `status: "measured"`), commit rồi
deploy lại. Khi `status` khác `measured`, trang `/eval` bỏ qua mọi số trong tệp và hiện "chưa đo".

## Cấu trúc

```
app/            layout, trang /, /tim-kiem, /eval; tokens.css (OKLCH, font, spacing, easing) + globals.css
components/     header, footer, sơ đồ luồng, drawer chat, thẻ sách, form/trạng thái tìm kiếm
lib/api.ts      client typed theo CONTRACT: timeout 30 s (AbortController), lỗi ApiError có code
lib/image.ts    nén ảnh bằng canvas: cạnh dài ≤ 1280 px, JPEG ≤ 4 MB → data URL
lib/session.ts  session_id trong sessionStorage (fallback bộ nhớ nếu bị chặn)
public/eval/    results.json
.hallmark/      nhật ký thiết kế (Hallmark)
```

## Thiết kế

Hallmark · editorial · macrostructure Map / Diagram · theme Almanac (giấy ấm, mực, điểm nhấn đỏ sẫm) · nav N1a · footer Ft4.
Font: Newsreader (tiêu đề), Be Vietnam Pro (chữ thân), JetBrains Mono (dữ liệu máy) — cả ba có subset `vietnamese`.
Chuyển động GSAP chỉ dùng transform/opacity: sơ đồ hiện lần lượt khi cuộn tới, drawer trượt vào, kết quả hiện so le;
`prefers-reduced-motion` ⇒ bỏ chuyển động không gian.
