alter table public.leads add column if not exists contacted_at timestamptz;
create index if not exists leads_owner_contacted_idx on public.leads (owner_id, contacted_at desc) where contacted_at is not null;
