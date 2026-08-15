alter table public.place_search_runs add column if not exists pagination_version integer not null default 1;
create index if not exists place_search_runs_owner_version_idx
  on public.place_search_runs (owner_id, pagination_version, created_at desc);
