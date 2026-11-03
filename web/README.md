# BiaScan — web

Giao diện Next.js (App Router) cho BiaScan: tìm sách bằng ảnh bìa hoặc mô tả trong kho cố định 950 đầu sách
([`sunbv56/biascan-950`](https://huggingface.co/datasets/sunbv56/biascan-950)), drawer chat tư vấn, trang `/eval`.
Web không có backend riêng — mọi lời gọi đi thẳng tới webhook n8n theo `docs/CONTRACT.md`.

| Trang | Nội dung |
|---|---|
| `/` | Giới thiệu, sơ đồ luồng OCR → embedding → pgvector → giải thích khi hỏi; số liệu kho + link dataset |
| `/tim-kiem` | Chụp/tải ảnh bìa (nén ở trình duyệt), ô mô tả, câu/ảnh mẫu bấm là tìm; top 3 có nút “Vì sao?” (1 lần gọi `biascan-explain` cho cả 3) + 7 kết quả gọn; nhãn “lấy từ bộ nhớ đệm” khi `cached: true` |
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

Chạy local thì n8n phải cho phép CORS từ `http://localhost:3000` (đã có sẵn trong workflow).

> Ổ NTFS (fuseblk): `next dev/build` trên ổ này hay lỗi ChunkLoadError/symlink. Khi đó sao chép thư mục sang ổ ext4
> (vd `rsync -a --exclude node_modules --exclude .next web/ ~/.cache/biascan-run/web/`) rồi cài và chạy ở đó.

## Deploy (xuất tĩnh)

`next.config.ts` đặt `output: "export"`: build ra `out/` toàn HTML/JS/CSS (~1,4 MB), không cần server Node.
Ảnh bìa tải thẳng từ `cdn0.fahasa.com` (`images.unoptimized`). Ảnh mẫu trên trang tìm kiếm được `fetch` về trình duyệt
(CDN trả `Access-Control-Allow-Origin: *`), nén như ảnh người dùng rồi gửi đi.

Bản demo chạy ở `https://biascan.thuanbt.id.vn`, do Caddy trên proxy Fly phục vụ file tĩnh và chuyển tiếp
`/webhook/biascan-search`, `/webhook/biascan-explain`, `/webhook/biascan-chat` sang n8n — cùng origin nên không cần CORS:

```bash
NEXT_PUBLIC_N8N_BASE_URL=/ NEXT_PUBLIC_BIASCAN_TOKEN=<token> npm run build
# copy out/ sang thư mục biascan/ của repo proxy rồi fly deploy
```

Token và URL được nhúng lúc build, đổi thì phải build lại. Host khác (Cloudflare Pages, GitHub Pages,
Vercel) cũng dùng được `out/`; khi đó đặt `NEXT_PUBLIC_N8N_BASE_URL=https://n8n.thuanbt.id.vn` và thêm
domain vào CORS của 3 webhook n8n.

## Lỗi từ n8n

`429 rate_limited` (quá nhiều yêu cầu/phút theo IP, thử lại sau ~1 phút) và `429 quota_exhausted` (mọi model Gemini
trong chuỗi dự phòng đã hết quota miễn phí trong ngày) được tách riêng: tìm kiếm, “Vì sao?” và chat đều hiện nguyên
thông điệp tiếng Việt của máy chủ; `quota_exhausted` không hiện nút “Thử lại”.

## Cập nhật số đo

Script trong `eval/` ghi đè `web/public/eval/results.json` (đúng schema trong CONTRACT, `status: "measured"`), commit rồi
deploy lại. Khi `status` khác `measured`, trang `/eval` bỏ qua mọi số trong tệp và hiện "chưa đo".

## Cấu trúc

```
app/            layout, trang /, /tim-kiem, /eval; tokens.css (OKLCH, font, spacing, easing) + globals.css
components/     header, footer, sơ đồ luồng, drawer chat, thẻ sách, form/trạng thái tìm kiếm
lib/api.ts      client typed theo CONTRACT (search, explain, chat): timeout 30 s, lỗi ApiError có code
lib/image.ts    nén ảnh bằng canvas: cạnh dài ≤ 768 px, JPEG q≈0,8 (≤ 4 MB) → data URL, ít token hơn khi OCR
lib/samples.ts  câu mẫu + 3 bìa mẫu (sách có trong kho 950 cuốn)
lib/site.ts     link GitHub/dataset, số liệu kho (950 sách, 937 có mô tả, 534 tác giả, 66 NXB)
lib/session.ts  session_id trong sessionStorage (fallback bộ nhớ nếu bị chặn)
public/eval/    results.json
.hallmark/      nhật ký thiết kế (Hallmark)
```

## Thiết kế

Hallmark · editorial · macrostructure Map / Diagram · theme Almanac (giấy ấm, mực, điểm nhấn đỏ sẫm) · nav N1a · footer Ft4.
Font: Newsreader (tiêu đề), Be Vietnam Pro (chữ thân), JetBrains Mono (dữ liệu máy) — cả ba có subset `vietnamese`.
Chuyển động GSAP chỉ dùng transform/opacity: sơ đồ hiện lần lượt khi cuộn tới, drawer trượt vào, kết quả hiện so le;
`prefers-reduced-motion` ⇒ bỏ chuyển động không gian.
