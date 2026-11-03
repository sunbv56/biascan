-- BiaScan — schema Supabase (Postgres 15+/pgvector). Chạy 1 lần trong SQL Editor; chạy lại an toàn.
-- Tên bảng/hàm/tham số khớp docs/CONTRACT.md.

create schema if not exists extensions;
create extension if not exists vector with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

set search_path = public, extensions;

-- ---------------------------------------------------------------- books
create table if not exists public.books (
  image_id        text primary key,
  title           text,
  author          text,
  publisher       text,
  supplier        text,
  description     text,
  product_url     text,
  image_url       text,
  title_norm      text,
  text_embedding  vector(768),
  image_embedding vector(768),
  embed_model     text,
  updated_at      timestamptz not null default now()
);

create index if not exists books_text_embedding_hnsw
  on public.books using hnsw (text_embedding vector_cosine_ops);
create index if not exists books_image_embedding_hnsw
  on public.books using hnsw (image_embedding vector_cosine_ops);
create index if not exists books_title_norm_trgm
  on public.books using gin (title_norm gin_trgm_ops);

create or replace function public.books_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists books_touch_updated_at on public.books;
create trigger books_touch_updated_at
  before update on public.books
  for each row execute function public.books_touch_updated_at();

-- ---------------------------------------------------------------- app_config
create table if not exists public.app_config (
  key   text primary key,
  value text,
  note  text
);

insert into public.app_config (key, value, note) values
  ('chat_model',         'gemini-flash-latest', 'Model Gemini trả lời chat + rerank'),
  ('ocr_model',          'gemini-flash-latest', 'Model Gemini đọc chữ trên ảnh bìa'),
  ('embed_model',        'gemini-embedding-2',  'Model embedding; đổi thì phải ingest lại toàn bộ'),
  ('embed_dims',         '768',                 'Số chiều vector; phải khớp vector(768) của bảng books'),
  ('top_k',              '10',                  'Số kết quả trả về cho web'),
  ('rerank_k',           '3',                   'Số kết quả đầu cho Gemini rerank + lý do'),
  ('desc_max_chars',     '2000',                'Cắt mô tả khi ghép văn bản embed'),
  ('rate_limit_per_min', '10',                  'Số request tối đa / IP / phút'),
  ('rate_limit_per_day', '200',                 'Số request tối đa / IP / 24 giờ')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- rate_limits
create table if not exists public.rate_limits (
  ip           text not null,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (ip, window_start)
);

create index if not exists rate_limits_window_start_idx
  on public.rate_limits (window_start);

-- true = đã vượt giới hạn. Mỗi lần gọi đếm thêm 1 vào ô phút hiện tại; cửa sổ ngày là 24 giờ trượt.
create or replace function public.hit_rate_limit(p_ip text, p_per_min int, p_per_day int)
returns boolean
language plpgsql
set search_path = public, extensions
as $$
declare
  v_ip      text := coalesce(nullif(btrim(p_ip), ''), 'unknown');
  v_minute  timestamptz := date_trunc('minute', now());
  v_min_cnt int;
  v_day_cnt bigint;
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';

  insert into public.rate_limits as r (ip, window_start, count)
  values (v_ip, v_minute, 1)
  on conflict (ip, window_start) do update set count = r.count + 1
  returning r.count into v_min_cnt;

  select coalesce(sum(r.count), 0) into v_day_cnt
  from public.rate_limits r
  where r.ip = v_ip and r.window_start > now() - interval '1 day';

  return v_min_cnt > p_per_min or v_day_cnt > p_per_day;
end;
$$;

-- ---------------------------------------------------------------- tìm kiếm
-- Tham số trùng tên cột: trong hàm SQL cột thắng, nên tham số luôn được gọi kèm tên hàm
-- (match_books_hybrid.text_embedding) còn cột luôn kèm alias b.

-- Ứng viên = top vector (HNSW) ∪ tên gần đúng (trigram). score = cosine + similarity nếu similarity ≥ 0.6.
create or replace function public.match_books_text(
  query_embedding vector(768),
  query_norm      text,
  match_count     int default 10
)
returns table (
  image_id    text,
  title       text,
  author      text,
  publisher   text,
  supplier    text,
  image_url   text,
  product_url text,
  description text,
  score       float
)
language sql
stable
set search_path = public, extensions
set hnsw.ef_search = 200
as $$
  with vec as (
    select b.image_id
    from public.books b
    where b.text_embedding is not null
    order by b.text_embedding <=> match_books_text.query_embedding
    limit greatest(match_books_text.match_count * 5, 50)
  ),
  trg as (
    select b.image_id
    from public.books b
    where coalesce(match_books_text.query_norm, '') <> ''
      and b.title_norm % match_books_text.query_norm
    order by similarity(b.title_norm, match_books_text.query_norm) desc
    limit 50
  ),
  cand as (
    select v.image_id from vec v
    union
    select t.image_id from trg t
  ),
  scored as (
    select
      b.*,
      (1 - (b.text_embedding <=> match_books_text.query_embedding))::float as cos_sim,
      coalesce(similarity(b.title_norm, match_books_text.query_norm), 0)::float as name_sim
    from cand c
    join public.books b on b.image_id = c.image_id
    where b.text_embedding is not null
  )
  select
    s.image_id, s.title, s.author, s.publisher, s.supplier,
    s.image_url, s.product_url, s.description,
    s.cos_sim + case when s.name_sim >= 0.6 then s.name_sim else 0 end as score
  from scored s
  order by score desc, s.image_id
  limit match_books_text.match_count;
$$;

create or replace function public.match_books_image(
  query_embedding vector(768),
  match_count     int default 10
)
returns table (
  image_id    text,
  title       text,
  author      text,
  publisher   text,
  supplier    text,
  image_url   text,
  product_url text,
  description text,
  score       float
)
language sql
stable
set search_path = public, extensions
set hnsw.ef_search = 200
as $$
  select
    b.image_id, b.title, b.author, b.publisher, b.supplier,
    b.image_url, b.product_url, b.description,
    (1 - (b.image_embedding <=> match_books_image.query_embedding))::float as score
  from public.books b
  where b.image_embedding is not null
  order by b.image_embedding <=> match_books_image.query_embedding, b.image_id
  limit match_books_image.match_count;
$$;

-- RRF: score = Σ 1/(rrf_k + hạng) trên 2 danh sách text/ảnh, cộng thêm similarity/(rrf_k + 1)
-- khi tên khớp ≥ 0.6 (tương đương một "phiếu hạng 1"). image_embedding null ⇒ trả đúng kết quả text.
create or replace function public.match_books_hybrid(
  text_embedding  vector(768),
  image_embedding vector(768),
  query_norm      text,
  match_count     int default 10,
  rrf_k           int default 60
)
returns table (
  image_id    text,
  title       text,
  author      text,
  publisher   text,
  supplier    text,
  image_url   text,
  product_url text,
  description text,
  score       float
)
language sql
stable
set search_path = public, extensions
set hnsw.ef_search = 200
as $$
  with params as (
    select greatest(match_books_hybrid.match_count * 5, 50) as n
  ),
  t as (
    select m.image_id, row_number() over (order by m.score desc, m.image_id) as rnk
    from params p,
         public.match_books_text(match_books_hybrid.text_embedding,
                                 match_books_hybrid.query_norm, p.n) m
    where match_books_hybrid.image_embedding is not null
  ),
  i as (
    select m.image_id, row_number() over (order by m.score desc, m.image_id) as rnk
    from params p,
         public.match_books_image(match_books_hybrid.image_embedding, p.n) m
    where match_books_hybrid.image_embedding is not null
  ),
  fused as (
    select
      coalesce(t.image_id, i.image_id) as image_id,
      coalesce(1.0 / (match_books_hybrid.rrf_k + t.rnk), 0)
        + coalesce(1.0 / (match_books_hybrid.rrf_k + i.rnk), 0) as rrf
    from t
    full outer join i on i.image_id = t.image_id
  ),
  hybrid as (
    select
      b.image_id, b.title, b.author, b.publisher, b.supplier,
      b.image_url, b.product_url, b.description,
      (f.rrf + case
         when coalesce(similarity(b.title_norm, match_books_hybrid.query_norm), 0) >= 0.6
         then similarity(b.title_norm, match_books_hybrid.query_norm)
              / (match_books_hybrid.rrf_k + 1)
         else 0 end)::float as score
    from fused f
    join public.books b on b.image_id = f.image_id
  )
  select h.* from hybrid h
  where match_books_hybrid.image_embedding is not null
  union all
  select m.*
  from public.match_books_text(match_books_hybrid.text_embedding,
                               match_books_hybrid.query_norm,
                               match_books_hybrid.match_count) m
  where match_books_hybrid.image_embedding is null
  order by score desc, image_id
  limit match_books_hybrid.match_count;
$$;

-- Workflow keep-alive của n8n gọi hằng ngày để project free không bị pause.
create or replace function public.keepalive()
returns int
language sql
stable
set search_path = ''
as $$ select 1 $$;

-- ---------------------------------------------------------------- bảo vệ
-- n8n và script nối bằng chuỗi Postgres (role postgres) nên bỏ qua RLS.
-- Bật RLS, không tạo policy ⇒ anon/authenticated qua REST API không đọc/ghi được gì.
alter table public.books       enable row level security;
alter table public.app_config  enable row level security;
alter table public.rate_limits enable row level security;

revoke execute on function public.hit_rate_limit(text, int, int) from public;
revoke execute on function public.match_books_text(vector, text, int) from public;
revoke execute on function public.match_books_image(vector, int) from public;
revoke execute on function public.match_books_hybrid(vector, vector, text, int, int) from public;
revoke execute on function public.keepalive() from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.books, public.app_config, public.rate_limits from %I', r);
      execute format('revoke execute on function public.hit_rate_limit(text, int, int) from %I', r);
      execute format('revoke execute on function public.match_books_text(vector, text, int) from %I', r);
      execute format('revoke execute on function public.match_books_image(vector, int) from %I', r);
      execute format('revoke execute on function public.match_books_hybrid(vector, vector, text, int, int) from %I', r);
      execute format('revoke execute on function public.keepalive() from %I', r);
    end if;
  end loop;
end;
$$;

-- Supabase mặc định cấp quyền cho anon/authenticated trên mọi bảng/hàm role postgres tạo sau này
-- trong public. n8n tự tạo n8n_chat_histories (lịch sử chat) bằng role postgres ⇒ chặn trước.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('alter default privileges in schema public revoke all on tables from %I', r);
      execute format('alter default privileges in schema public revoke all on sequences from %I', r);
      execute format('alter default privileges in schema public revoke all on functions from %I', r);
      if to_regclass('public.n8n_chat_histories') is not null then
        execute format('revoke all on public.n8n_chat_histories from %I', r);
      end if;
    end if;
  end loop;
  if to_regclass('public.n8n_chat_histories') is not null then
    alter table public.n8n_chat_histories enable row level security;
  end if;
end;
$$;
