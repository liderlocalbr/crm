create table if not exists public.saved_place_searches (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  keyword text not null check (char_length(trim(keyword)) between 2 and 80),
  locality text not null check (char_length(trim(locality)) between 2 and 100),
  guide_state text,
  guide_city text,
  prospect_filter text not null default 'all' check (prospect_filter in ('all', 'new', 'prospected', 'lead')),
  result_count integer not null default 0 check (result_count >= 0),
  is_complete boolean not null default false,
  last_opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_place_searches_owner_updated_idx
  on public.saved_place_searches (owner_id, updated_at desc);
create index if not exists saved_place_searches_owner_keyword_idx
  on public.saved_place_searches (owner_id, keyword, locality);

alter table public.saved_place_searches enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_searches' and policyname = 'saved_place_searches_select_own') then
    create policy saved_place_searches_select_own on public.saved_place_searches for select to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_searches' and policyname = 'saved_place_searches_insert_own') then
    create policy saved_place_searches_insert_own on public.saved_place_searches for insert to authenticated with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_searches' and policyname = 'saved_place_searches_update_own') then
    create policy saved_place_searches_update_own on public.saved_place_searches for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_searches' and policyname = 'saved_place_searches_delete_own') then
    create policy saved_place_searches_delete_own on public.saved_place_searches for delete to authenticated using ((select auth.uid()) = owner_id);
  end if;
end $$;

grant select, insert, update, delete on public.saved_place_searches to authenticated;
