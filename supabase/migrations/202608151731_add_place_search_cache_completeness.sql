alter table public.place_search_cache
  add column if not exists is_complete boolean not null default false;
