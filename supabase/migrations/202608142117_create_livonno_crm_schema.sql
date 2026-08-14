create extension if not exists pgcrypto;

create table public.funnel_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  deal_value numeric(12,2) not null default 3000 check (deal_value >= 0),
  leads_goal integer not null default 1650 check (leads_goal >= 0),
  lead_to_message numeric(5,2) not null default 90 check (lead_to_message between 0 and 100),
  message_to_scheduled numeric(5,2) not null default 2 check (message_to_scheduled between 0 and 100),
  scheduled_to_completed numeric(5,2) not null default 40 check (scheduled_to_completed between 0 and 100),
  completed_to_negotiation numeric(5,2) not null default 70 check (completed_to_negotiation between 0 and 100),
  negotiation_to_sale numeric(5,2) not null default 35 check (negotiation_to_sale between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.daily_metrics (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  metric_date date not null,
  leads integer not null default 0 check (leads >= 0),
  messages integer not null default 0 check (messages >= 0),
  meetings_scheduled integer not null default 0 check (meetings_scheduled >= 0),
  meetings_completed integer not null default 0 check (meetings_completed >= 0),
  negotiations integer not null default 0 check (negotiations >= 0),
  sales integer not null default 0 check (sales >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, metric_date)
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) > 0),
  clinic_name text,
  specialty text,
  whatsapp text,
  email text,
  source text not null default 'Prospecção ativa',
  stage text not null default 'new' check (stage in ('new','contacted','scheduled','completed','negotiation','won','lost')),
  deal_value numeric(12,2) check (deal_value is null or deal_value >= 0),
  next_follow_up date,
  notes text,
  stage_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  kind text not null default 'follow_up' check (kind in ('call','whatsapp','email','meeting','follow_up','note')),
  title text not null check (char_length(trim(title)) > 0),
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.lead_stage_events (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  from_stage text,
  to_stage text not null,
  occurred_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger funnel_settings_set_updated_at before update on public.funnel_settings for each row execute function public.set_updated_at();
create trigger daily_metrics_set_updated_at before update on public.daily_metrics for each row execute function public.set_updated_at();
create trigger leads_set_updated_at before update on public.leads for each row execute function public.set_updated_at();

create or replace function public.track_lead_stage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_stage_events (owner_id, lead_id, from_stage, to_stage, occurred_at)
    values (new.owner_id, new.id, null, new.stage, new.created_at);
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at = now();
    insert into public.lead_stage_events (owner_id, lead_id, from_stage, to_stage, occurred_at)
    values (new.owner_id, new.id, old.stage, new.stage, now());
  end if;
  return new;
end;
$$;

create trigger leads_track_stage before insert or update of stage on public.leads for each row execute function public.track_lead_stage();

create index daily_metrics_owner_date_idx on public.daily_metrics (owner_id, metric_date desc);
create index leads_owner_stage_idx on public.leads (owner_id, stage);
create index leads_owner_follow_up_idx on public.leads (owner_id, next_follow_up);
create index activities_owner_due_idx on public.activities (owner_id, due_at);
create index lead_stage_events_owner_date_idx on public.lead_stage_events (owner_id, occurred_at desc);

alter table public.funnel_settings enable row level security;
alter table public.daily_metrics enable row level security;
alter table public.leads enable row level security;
alter table public.activities enable row level security;
alter table public.lead_stage_events enable row level security;

create policy "funnel_settings_select_own" on public.funnel_settings for select to authenticated using ((select auth.uid()) = owner_id);
create policy "funnel_settings_insert_own" on public.funnel_settings for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "funnel_settings_update_own" on public.funnel_settings for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "funnel_settings_delete_own" on public.funnel_settings for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "daily_metrics_select_own" on public.daily_metrics for select to authenticated using ((select auth.uid()) = owner_id);
create policy "daily_metrics_insert_own" on public.daily_metrics for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "daily_metrics_update_own" on public.daily_metrics for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "daily_metrics_delete_own" on public.daily_metrics for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "leads_select_own" on public.leads for select to authenticated using ((select auth.uid()) = owner_id);
create policy "leads_insert_own" on public.leads for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "leads_update_own" on public.leads for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "leads_delete_own" on public.leads for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "activities_select_own" on public.activities for select to authenticated using ((select auth.uid()) = owner_id);
create policy "activities_insert_own" on public.activities for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "activities_update_own" on public.activities for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "activities_delete_own" on public.activities for delete to authenticated using ((select auth.uid()) = owner_id);

create policy "lead_stage_events_select_own" on public.lead_stage_events for select to authenticated using ((select auth.uid()) = owner_id);
create policy "lead_stage_events_insert_own" on public.lead_stage_events for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "lead_stage_events_delete_own" on public.lead_stage_events for delete to authenticated using ((select auth.uid()) = owner_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.funnel_settings to authenticated;
grant select, insert, update, delete on public.daily_metrics to authenticated;
grant select, insert, update, delete on public.leads to authenticated;
grant select, insert, update, delete on public.activities to authenticated;
grant select, insert, delete on public.lead_stage_events to authenticated;
grant usage, select on sequence public.lead_stage_events_id_seq to authenticated;
