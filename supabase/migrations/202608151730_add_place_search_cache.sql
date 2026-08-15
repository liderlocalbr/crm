create table if not exists public.place_search_cache (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  keyword text not null check (char_length(trim(keyword)) between 2 and 80),
  locality text not null check (char_length(trim(locality)) between 2 and 100),
  place_id text not null check (char_length(trim(place_id)) between 1 and 255),
  name text not null check (char_length(trim(name)) between 1 and 255),
  address text not null default '',
  phone text not null default '',
  website text not null default '',
  rating numeric,
  rating_count integer,
  maps_url text not null default '',
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, keyword, locality, place_id)
);

create index if not exists place_search_cache_lookup_idx
  on public.place_search_cache (owner_id, keyword, locality, position);

alter table public.place_search_cache enable row level security;

drop trigger if exists place_search_cache_set_updated_at on public.place_search_cache;
create trigger place_search_cache_set_updated_at
  before update on public.place_search_cache
  for each row execute function public.set_updated_at();

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_cache' and policyname = 'place_search_cache_select_own') then
    create policy place_search_cache_select_own on public.place_search_cache for select to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_cache' and policyname = 'place_search_cache_insert_own') then
    create policy place_search_cache_insert_own on public.place_search_cache for insert to authenticated with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_cache' and policyname = 'place_search_cache_update_own') then
    create policy place_search_cache_update_own on public.place_search_cache for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_cache' and policyname = 'place_search_cache_delete_own') then
    create policy place_search_cache_delete_own on public.place_search_cache for delete to authenticated using ((select auth.uid()) = owner_id);
  end if;
end $$;
