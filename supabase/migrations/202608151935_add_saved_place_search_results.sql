create table if not exists public.saved_place_search_results (
  id uuid primary key default gen_random_uuid(),
  saved_search_id uuid not null references public.saved_place_searches(id) on delete cascade,
  place_id text not null,
  name text not null,
  address text,
  phone text,
  website text,
  rating numeric,
  rating_count integer,
  maps_url text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (saved_search_id, place_id)
);

create index if not exists saved_place_search_results_search_position_idx
  on public.saved_place_search_results (saved_search_id, position);

alter table public.saved_place_search_results enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_search_results' and policyname = 'saved_place_search_results_select_own') then
    create policy saved_place_search_results_select_own on public.saved_place_search_results for select to authenticated using (exists (select 1 from public.saved_place_searches s where s.id = saved_search_id and s.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_search_results' and policyname = 'saved_place_search_results_insert_own') then
    create policy saved_place_search_results_insert_own on public.saved_place_search_results for insert to authenticated with check (exists (select 1 from public.saved_place_searches s where s.id = saved_search_id and s.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_search_results' and policyname = 'saved_place_search_results_update_own') then
    create policy saved_place_search_results_update_own on public.saved_place_search_results for update to authenticated using (exists (select 1 from public.saved_place_searches s where s.id = saved_search_id and s.owner_id = (select auth.uid()))) with check (exists (select 1 from public.saved_place_searches s where s.id = saved_search_id and s.owner_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_place_search_results' and policyname = 'saved_place_search_results_delete_own') then
    create policy saved_place_search_results_delete_own on public.saved_place_search_results for delete to authenticated using (exists (select 1 from public.saved_place_searches s where s.id = saved_search_id and s.owner_id = (select auth.uid())));
  end if;
end $$;

grant select, insert, update, delete on public.saved_place_search_results to authenticated;
