# eval/ — đo độ chính xác tìm sách của BiaScan

Đo xem BiaScan tìm đúng sách tới đâu, nhanh cỡ nào, với 3 bộ câu hỏi có đáp án biết trước. Kết quả
ghi vào `web/public/eval/results.json` (schema ở `docs/CONTRACT.md`), trang `/eval` đọc file này.

## Cài đặt

```bash
cd eval
python3 -m venv .venv          # đã thử với Python 3.14; nếu thiếu wheel thì dùng 3.12
.venv/bin/pip install -r requirements.txt
cp .env.example .env           # điền GEMINI_API_KEY, DATABASE_URL, BIASCAN_TOKEN...
```

Dữ liệu sách tự tải từ HF ([`sunbv56/biascan-950`](https://huggingface.co/datasets/sunbv56/biascan-950),
file `data/train.parquet`, lưu cache của `huggingface_hub`); có file sẵn thì đặt `BIASCAN_DATASET=<đường dẫn .parquet
hoặc .jsonl>`. Dữ liệu sinh ra nằm trong `eval/data/` (đã gitignore, không commit).

**Chỉ đánh giá trong kho 950 sách.** Kho là đúng các sách trong dataset `biascan-950` (950 sản phẩm khác nhau đầu tiên
của dataset gốc, đã bỏ sản phẩm trùng nên `image_id` không liền mạch): `build_sets.py` chọn mẫu từ dataset này,
`run_eval.py` bỏ mẫu có đáp án ngoài kho (và với `--via direct` bỏ thêm mẫu có đáp án không nằm trong bảng `books`).

## 1. Tạo bộ đánh giá — `build_sets.py`

Seed cố định (`--seed 20261103`), chạy lại cho ra đúng các sách và đúng các biến dạng như cũ.

| Lệnh | Kết quả |
|---|---|
| `python build_sets.py image_aug` | 100 ảnh `data/image_aug/*.jpg` + `manifest.jsonl` `{query_image, expected_id, aug}` |
| `python build_sets.py text_query` | 100 câu `data/text_query/manifest.jsonl` `{query, expected_id}` + `rejected.jsonl` |
| `python build_sets.py real_photo` | Kiểm `data/real_photo/manifest.jsonl` (ảnh có thật, id nằm trong kho 950 sách) |
| `python build_sets.py real_photo --find "đắc nhân tâm"` | Tra `image_id` theo tên sách để điền manifest |

`--n` đổi số mẫu, `--mock` (text_query) dùng câu giả không gọi Gemini và ghi sang
`data/text_query_mock/` để thử luồng. `text_query` mặc định giãn 4,5 s giữa 2 lần gọi
(`--min-interval`) cho vừa quota free.

### Ảnh tự chụp (`real_photo`) — việc bạn tự làm

1. Chọn ~20 cuốn sách thật **có trong kho 950 cuốn** (tra bằng `--find`; càng đa dạng càng tốt: bìa chữ to,
   bìa nhiều hình, truyện tranh, sách ngoại văn).
2. Chụp bằng điện thoại như người dùng thật: cầm tay, có nền bàn, hơi nghiêng, đèn phòng. Không cần
   căn chỉnh. Lưu vào `eval/data/real_photo/` (tên bất kỳ, `.jpg`/`.png`).
3. Tìm `image_id` từng cuốn: `python build_sets.py real_photo --find "<tên sách>"`.
4. Tạo `eval/data/real_photo/manifest.jsonl`, mỗi dòng một ảnh:
   ```json
   {"query_image": "IMG_0012.jpg", "expected_id": "fahasa_1"}
   ```
5. Chạy `python build_sets.py real_photo` tới khi báo 0 lỗi.

## 2. Chạy đo — `run_eval.py`

```bash
python run_eval.py --via n8n                       # toàn hệ thống thật, đo latency đầu-cuối
python run_eval.py --via direct --modes text,image,hybrid   # ablation: so sánh 3 cách tìm
python run_eval.py --via direct --limit 5 --out /tmp/r.json # chạy thử
```

- `--via n8n`: gọi `POST {N8N_BASE_URL}/webhook/biascan-search` kèm header `x-biascan-token`, đúng
  như web gọi (ảnh nén cạnh dài ≤ 768 px, JPEG q80). Latency là thời gian từ lúc gửi tới lúc nhận đủ phản hồi,
  gồm OCR, embed và tìm kiếm (tìm kiếm không gọi model sinh chữ; câu trùng có thể trả từ cache). Mặc định
  giãn 6,5 s giữa 2 request vì rate limit 10/phút/IP; gặp `429 rate_limited` thì chờ 65 s rồi thử lại, gặp
  `429 quota_exhausted` (Gemini hết quota miễn phí trong ngày) thì dừng ngay như hết quota. Mặc định khoảng
  240 truy vấn (100 + 100 + ~20 ảnh thật, nhân số mode) — vượt mức 200/ngày thì tạm nâng `rate_limit_per_min`,
  `rate_limit_per_day` trong `app_config`, hoặc chạy từng tập qua 2 ngày với `--sets … --merge`. Tập ảnh được ghi nhãn mode
  theo `--n8n-mode` (mặc định `text` = workflow OCR→text; đặt `hybrid` nếu workflow đã gộp ảnh bằng RRF).
- `--via direct`: script tự OCR (Gemini, `OCR_MODEL`), tự embed (`EMBED_MODEL`, 768 chiều, chuẩn hoá
  L2 như ingest) rồi gọi thẳng các hàm RPC trong Postgres:
  - `text`: OCR → embed chữ → `match_books_text` (kèm `query_norm` để boost khớp tên).
  - `image`: embed thẳng ảnh → `match_books_image`.
  - `hybrid`: cả hai → `match_books_hybrid` (RRF).
  Tập `text_query` chỉ có mode `text`. Không có rerank. Latency mode = tổng tuần tự các bước
  (OCR + embed + RPC), không tính thời gian chờ throttle. Kết quả OCR/embedding được lưu ở
  `eval/out/cache/` nên chạy lại hoặc chạy tiếp sau khi bị ngắt không tốn quota lần nữa (latency khi đó
  là số đo của lần gọi đầu).
- `--merge` giữ lại các dòng `(set, mode)` đã có trong `results.json`, chỉ thay dòng vừa chạy lại.
- Truy vấn lỗi (HTTP, timeout) được tính là **trượt** và không tính vào latency; chi tiết từng truy vấn
  ở `eval/out/details-*.jsonl`. Nếu lỗi quá `--max-error-rate` (mặc định 5%) hoặc lượt chạy dừng giữa
  chừng vì hết quota (429 liên tục) thì **không ghi** `results.json`, để trang `/eval` không hiện số sai.
- `--limit` bắt buộc đi kèm `--out` khác `web/public/eval/results.json`.
- `--via direct` với mode `image`/`hybrid` từ chối chạy nếu DB chưa có `image_embedding` nào.

`python make_placeholder.py` ghi `results.json` với `status: placeholder`, mọi chỉ số `null` (chỉ giữ
`n` dự kiến) để web hiện "chưa đo" khi chưa chạy thật.

## Phương pháp

**Vì sao chỉ 100 ảnh / 100 câu.** Quota Gemini miễn phí theo ngày có hạn; 100 mẫu mỗi bộ đủ để thấy chênh lệch
giữa các chế độ (mỗi mẫu = 1 điểm phần trăm) mà chạy xong trong một ngày quota. Cần nhiều hơn thì `--n`.

**Vì sao làm hỏng ảnh.** Ảnh bìa trong DB là ảnh scan sạch từ Fahasa. Nếu đem chính ảnh đó đi tìm
thì gần như chắc chắn đúng, con số đẹp nhưng vô nghĩa. Người dùng thật chụp bằng điện thoại: nghiêng,
lệch, có nền bàn, mờ, thiếu sáng, bị cắt mép, nén JPEG. `augment.py` mô phỏng đúng những thứ đó cho
mỗi ảnh với tham số ngẫu nhiên (theo seed): đặt lên nền nhiễu có đổ bóng, phối cảnh lệch ≤6%,
xoay ±12°, cắt còn 70–95% diện tích khung, đổi sáng 0,6–1,35 / tương phản 0,7–1,3 / bão hoà,
blur Gaussian ≤2 px, thu nhỏ 640–1024 px, nén JPEG q=40–70. Tham số từng ảnh lưu ở trường `aug`.
Bộ 20 ảnh tự chụp để kiểm xem mô phỏng có sát thực tế không: nếu điểm `real_photo` thấp hơn hẳn
`image_aug` thì bộ biến dạng còn quá nhẹ.

**Vì sao cấm tên sách trong câu mô tả.** Hệ thống có boost khớp tên (trigram trên `title_norm`). Nếu
câu hỏi chứa tên sách thì đó là bài tra tên, không phải bài hiểu nhu cầu. Người dùng ở chế độ này
thường không nhớ tên, chỉ nhớ nội dung. Vì vậy Gemini viết câu "Sách về…" từ phần giới thiệu (đã bỏ
dòng đầu trùng tên sách), được dặn từ cấm, rồi mỗi câu bị kiểm lại bằng `textnorm.normalize` (không
dấu, đ→d): loại nếu chứa nguyên tên sách, phần chính của tên (trước `-`, `:`, `(`, "tập"), 4 từ liền
nhau của tên, hoặc tên tác giả (bỏ "Nhiều tác giả", tên < 4 ký tự). Câu vi phạm được viết lại 1 lần,
vẫn sai thì bỏ cuốn đó, lấy cuốn kế. Mọi câu bị loại ghi ở `rejected.jsonl` để xem lại.
Mỗi cuốn xong là ghi ngay vào `manifest.jsonl`; chạy lại thì làm tiếp từ chỗ dừng (bỏ qua cuốn đã có
câu hoặc đã bị loại 2 lần). Hết quota Gemini thì script dừng hẳn thay vì đánh dấu loại từng cuốn.
Muốn tạo lại từ đầu thì xoá `data/text_query/`.
Giới hạn: câu vẫn có thể lộ tên nhân vật/bộ truyện không nằm trong tên sách — nên đọc lướt manifest.

**Các chỉ số.** Mỗi truy vấn có đúng 1 sách đáp án; hệ thống trả top 10.

- **Recall@1**: tỉ lệ truy vấn mà sách đúng đứng hạng 1 — người dùng thấy ngay.
- **Recall@10**: tỉ lệ sách đúng nằm trong 10 kết quả — có trên màn hình.
- **MRR** (Mean Reciprocal Rank, tính trong top 10): trung bình 1/hạng của sách đúng (hạng 1 → 1,
  hạng 2 → 0,5, ngoài top 10 → 0). Phân biệt "đúng ở hạng 2" với "đúng ở hạng 9" mà Recall@10 coi như nhau.
- **Latency p50 / p95** (ms): trung vị và mức 95% truy vấn nhanh hơn — p95 cho biết lúc chậm thì chậm cỡ nào.

**Text / image / hybrid.** Bảng so sánh trả lời câu hỏi: nên tìm qua chữ OCR, qua embedding ảnh, hay
gộp cả hai. Chỉ chạy được mode `image`/`hybrid` khi DB đã có `image_embedding` (phase 2 của ingest).

## Tự kiểm (local, không commit)

`tests_local/` (gitignored) có unit test cho metric, `normalize`, bộ lọc tên, biến dạng ảnh, luồng
`run_eval` với Gemini/Postgres/n8n giả và schema `results.json`:

```bash
.venv/bin/pip install pytest && .venv/bin/python -m pytest -q tests_local
```
