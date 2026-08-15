-- Histórico e estado de prospecção por estabelecimento do Maps.
alter table public.leads add column if not exists place_id text;
create unique index if not exists leads_owner_place_id_unique
  on public.leads (owner_id, place_id)
  where place_id is not null;

alter table public.place_references add column if not exists status text not null default 'prospected';
alter table public.place_references add column if not exists prospected_at timestamptz not null default now();
alter table public.place_references add column if not exists lead_id uuid references public.leads(id) on delete set null;
alter table public.place_references drop constraint if exists place_references_status_check;
alter table public.place_references add constraint place_references_status_check
  check (status in ('prospected', 'contacted', 'converted', 'discarded'));

create index if not exists place_references_owner_status_idx
  on public.place_references (owner_id, status, updated_at desc);
create index if not exists place_references_owner_lead_idx
  on public.place_references (owner_id, lead_id);

create table if not exists public.place_search_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  keyword text not null check (char_length(trim(keyword)) between 2 and 80),
  locality text not null check (char_length(trim(locality)) between 2 and 100),
  requested_count integer not null default 20 check (requested_count between 20 and 150),
  returned_count integer not null default 0 check (returned_count >= 0),
  search_center text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, keyword, locality)
);

alter table public.place_search_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_runs' and policyname = 'place_search_runs_select_own') then
    create policy place_search_runs_select_own on public.place_search_runs for select to authenticated using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_runs' and policyname = 'place_search_runs_insert_own') then
    create policy place_search_runs_insert_own on public.place_search_runs for insert to authenticated with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_runs' and policyname = 'place_search_runs_update_own') then
    create policy place_search_runs_update_own on public.place_search_runs for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'place_search_runs' and policyname = 'place_search_runs_delete_own') then
    create policy place_search_runs_delete_own on public.place_search_runs for delete to authenticated using ((select auth.uid()) = owner_id);
  end if;
end $$;

grant select, insert, update, delete on public.place_search_runs to authenticated;
