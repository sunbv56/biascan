-- BiaScan — giảm request Gemini (03/11/2026). Chạy 1 lần trên DB đã có schema cũ; chạy lại an toàn.
-- Thêm: search_cache, chat_turns, purge_expired(), khoá app_config llm_models / chat_k / cache_ttl_hours.

set search_path = public, extensions;

-- ---------------------------------------------------------------- search_cache
-- q:<chữ tìm chuẩn hoá> → {results}; img:<sha256 base64 ảnh> → {ocr_text, ocr_title};
-- why:<query chuẩn hoá>|<ids> → {reasons}. Hết hạn sau cache_ttl_hours (n8n lọc theo created_at).
create table if not exists public.search_cache (
  cache_key  text primary key,
  payload    jsonb not null,
  hits       int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists search_cache_created_at_idx on public.search_cache (created_at);

-- ---------------------------------------------------------------- chat_turns
-- Lịch sử chat do workflow tự ghi (thay Postgres Chat Memory / n8n_chat_histories).
create table if not exists public.chat_turns (
  id         bigint generated always as identity primary key,
  session_id text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_turns_session_idx on public.chat_turns (session_id, id desc);

-- Workflow keep-alive gọi hằng ngày: xoá cache quá hạn và lượt chat cũ hơn 30 ngày.
create or replace function public.purge_expired()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_hours int;
  v_cache int;
  v_chat  int;
begin
  select case when value ~ '^[0-9]+$' then value::int else 168 end into v_hours
  from public.app_config where key = 'cache_ttl_hours';
  delete from public.search_cache
  where created_at < now() - make_interval(hours => coalesce(v_hours, 168));
  get diagnostics v_cache = row_count;
  delete from public.chat_turns where created_at < now() - interval '30 days';
  get diagnostics v_chat = row_count;
  return v_cache + v_chat;
end;
$$;

-- ---------------------------------------------------------------- app_config
insert into public.app_config (key, value, note) values
  ('llm_models',      'gemini-3.5-flash-lite,gemma-4-31b-it,gemini-3.8-flash',
                      'Chuỗi model dự phòng cho OCR, chat, giải thích (tối đa 3, cách nhau dấu phẩy)'),
  ('chat_k',          '5',   'Số sách tìm theo tin nhắn đưa vào ngữ cảnh chat'),
  ('cache_ttl_hours', '168', 'Thời hạn cache search_cache (giờ)')
on conflict (key) do nothing;

update public.app_config
set note = 'Không còn dùng (thay bằng llm_models / bỏ rerank)'
where key in ('chat_model', 'ocr_model', 'rerank_k');

-- ---------------------------------------------------------------- bảo vệ
alter table public.search_cache enable row level security;
alter table public.chat_turns   enable row level security;
revoke execute on function public.purge_expired() from public;

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on public.search_cache, public.chat_turns from %I', r);
      execute format('revoke execute on function public.purge_expired() from %I', r);
    end if;
  end loop;
end;
$$;
