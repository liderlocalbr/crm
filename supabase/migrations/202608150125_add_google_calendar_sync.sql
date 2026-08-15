alter table public.activities
  add column if not exists google_event_id text,
  add column if not exists google_event_url text;

create unique index if not exists activities_owner_google_event_idx
  on public.activities (owner_id, google_event_id)
  where google_event_id is not null;
