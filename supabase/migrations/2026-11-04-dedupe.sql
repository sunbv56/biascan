-- BiaScan — bỏ sách trùng (04/11/2026). Chạy sau `ingest.py --limit 950 --prune`; chạy lại an toàn.
-- Dataset gốc lặp lại cùng sản phẩm dưới nhiều image_id (kho 950 cũ chỉ có 741 sản phẩm khác nhau).

set search_path = public, extensions;

-- Còn sót bản trùng thì giữ image_id nhỏ nhất của mỗi link sản phẩm.
delete from public.books b
using public.books keep
where split_part(b.product_url, '?', 1) = split_part(keep.product_url, '?', 1)
  and coalesce(b.product_url, '') <> ''
  and substring(keep.image_id from '[0-9]+$')::int < substring(b.image_id from '[0-9]+$')::int;

create unique index if not exists books_product_key_uniq
  on public.books (split_part(product_url, '?', 1))
  where coalesce(product_url, '') <> '';

-- Kết quả cache có thể còn trỏ tới sách đã xoá.
delete from public.search_cache;
