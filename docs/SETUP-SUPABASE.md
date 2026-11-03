# Cài Supabase cho BiaScan (free tier)

Kết quả cuối: 1 project Supabase ở Singapore đã chạy `supabase/schema.sql`, một chuỗi kết nối
**Session pooler** cho `ingest/`, `eval/`, và một credential Postgres trong n8n.

## 1. Kiểm số project free

1. Vào <https://supabase.com/dashboard/projects>.
2. Gói Free chỉ cho **2 project đang chạy (active)**; project đã pause không tính.
   Nếu đã có 2 project chạy:
   - **Pause** project cũ: mở project → *Project Settings → General → Pause project*.
     Dữ liệu giữ nguyên, bấm *Restore* khi cần dùng lại.
   - Hoặc **xoá** hẳn: *Project Settings → General → Delete project* (mất dữ liệu, không lấy lại được).

## 2. Tạo project

1. *New project* → chọn organization (gói Free).
2. **Name**: `biascan`.
3. **Database Password**: bấm *Generate a password*, **lưu ngay** vào trình quản lý mật khẩu.
   Mật khẩu chỉ hiện lúc này; quên thì phải đặt lại ở *Database → Settings → Reset database password*.
   Nên tránh ký tự `@ : / ? #` để khỏi phải mã hoá khi ghép vào URL.
4. **Region**: *Southeast Asia (Singapore)* — gần Việt Nam và gần n8n nhất.
5. *Create new project*, đợi 1–2 phút tới khi trạng thái xanh.

## 3. Chạy schema

1. Menu trái → **SQL Editor** → *New query*.
2. Dán toàn bộ nội dung `supabase/schema.sql` → **Run**.
3. Kết quả mong đợi: `Success. No rows returned`. Chạy lại lần nữa vẫn an toàn (không mất dữ liệu,
   không ghi đè `app_config` đã sửa).
4. Kiểm nhanh, chạy trong SQL Editor:

   ```sql
   select * from app_config order by key;          -- 9 dòng
   select keepalive();                             -- 1
   ```

   Nếu Supabase cảnh báo "RLS enabled, no policies": đúng như thiết kế. Web không gọi Supabase
   trực tiếp; chỉ n8n và script nối bằng chuỗi Postgres (role `postgres`, bỏ qua RLS).

   Schema cũng chặn trước quyền của `anon`/`authenticated` trên bảng mới trong `public`. Bảng cache
   (`search_cache`) và lịch sử chat (`chat_turns`) được tạo sẵn, đã bật RLS.

   DB đã chạy `schema.sql` bản cũ (trước 03/11/2026): chạy thêm `supabase/migrations/2026-11-03-quota.sql`.

## 4. Lấy chuỗi kết nối Session pooler

1. Bấm nút **Connect** ở thanh trên cùng của project.
2. Tab *Connection String* → mục **Session pooler** (hỗ trợ IPv4, cổng **5432**).
   Không dùng *Direct connection* (chỉ IPv6) hay *Transaction pooler* (cổng 6543, không hợp
   với Postgres Chat Memory của n8n).
3. Chuỗi có dạng:

   ```
   postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
   ```

   Thay `[YOUR-PASSWORD]` bằng mật khẩu ở bước 2 rồi điền vào `DATABASE_URL` của
   `ingest/.env` và `eval/.env`. Host thực tế có thể là `aws-1-...`; cứ chép đúng như dashboard.

## 5. Credential Postgres trong n8n

*Credentials → Add credential → Postgres*, điền theo chuỗi ở bước 4:

| Ô | Giá trị |
|---|---|
| Host | `aws-0-ap-southeast-1.pooler.supabase.com` (phần sau `@`, trước `:5432`) |
| Database | `postgres` |
| User | `postgres.<project-ref>` (có cả phần `.<project-ref>`) |
| Password | mật khẩu DB |
| Port | `5432` |
| SSL | `Require` (nếu báo lỗi chứng chỉ thì bật *Ignore SSL Issues*) |
| Maximum Number of Connections | `5` (Supabase free giới hạn số kết nối pooler) |

Bấm *Save* — n8n tự thử kết nối. Đặt tên `Supabase BiaScan` để các workflow `n8n/*.json` dùng chung.

## 6. Đổi model / tham số không sửa code

Mọi workflow đọc bảng `app_config`. Sửa trong *Table Editor → app_config* hoặc SQL Editor:

```sql
update app_config set value = 'gemini-3.5-flash-lite,gemini-3.8-flash,gemma-4-31b-it' where key = 'llm_models';
update app_config set value = '20' where key = 'rate_limit_per_min';
```

- `llm_models` (chuỗi model dự phòng, tối đa 3), `top_k`, `chat_k`, `cache_ttl_hours`, `rate_limit_*`: đổi xong có
  hiệu lực ngay. Đổi model mà muốn bỏ kết quả cũ thì `delete from search_cache;`.
- `embed_model`, `embed_dims`, `desc_max_chars`: đổi là **vector cũ không còn so được** — phải
  ingest lại toàn bộ; `embed_dims` khác 768 còn phải sửa `vector(768)` trong schema.
  Nhớ sửa luôn biến tương ứng trong `ingest/.env`, `eval/.env`.

## 7. Project free bị pause sau 7 ngày

- Supabase free tự **pause** project không có hoạt động trong 7 ngày (gửi email báo trước).
  Khi pause, n8n gọi DB sẽ lỗi → web trả `502 upstream`.
- Workflow keep-alive trong `n8n/` chạy hằng ngày, gọi `select keepalive();` qua credential ở bước 5.
  Bật (Active) workflow đó sau khi import.
- Nếu vẫn bị pause: vào dashboard bấm *Restore project* (vài phút), dữ liệu còn nguyên.

## 8. Giới hạn 500 MB và ước tính dung lượng

Free cho **500 MB** database; vượt thì project chuyển chỉ-đọc. Ước tính với 33.531 sách:

| Phần | Ước tính |
|---|---|
| `text_embedding` 768 float4 ≈ 3,1 KB/dòng | ~105 MB |
| Index HNSW cho `text_embedding` | ~110–140 MB |
| Text (tiêu đề, URL, mô tả ≤ 2.000 ký tự, trung vị 925) | ~40–60 MB |
| Index trigram `title_norm`, khoá chính | ~5–10 MB |
| **Tổng chỉ có text** | **~260–320 MB** |
| Thêm `image_embedding` + HNSW cho cả 33,5k ảnh | +~220–250 MB → **sát/vượt 500 MB** |

- Theo dõi: *Project Settings → Usage* hoặc
  `select pg_size_pretty(pg_database_size(current_database()));`
- Nạp ảnh bìa (phase 2) cho toàn bộ sẽ không đủ chỗ ở gói free. Phương án: chỉ nạp ảnh cho
  một phần sách, hoặc giảm `embed_dims` (vd 512) cho ảnh — cần sửa schema và CONTRACT trước.
- `chat_turns` và `search_cache` được `purge_expired()` (workflow keep-alive) dọn hằng ngày: lượt chat > 30 ngày,
  cache quá `cache_ttl_hours`.
