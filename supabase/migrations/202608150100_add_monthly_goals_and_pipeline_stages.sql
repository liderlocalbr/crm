alter table public.funnel_settings
  add column if not exists goal_month date;

update public.funnel_settings
set goal_month = date_trunc('month', current_date)::date
where goal_month is null;

alter table public.funnel_settings
  alter column goal_month set default date_trunc('month', current_date)::date,
  alter column goal_month set not null;

alter table public.funnel_settings
  drop constraint if exists funnel_settings_pkey;

alter table public.funnel_settings
  add constraint funnel_settings_pkey primary key (owner_id, goal_month);

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  stage_key text not null check (char_length(trim(stage_key)) between 1 and 80),
  name text not null check (char_length(trim(name)) between 1 and 48),
  color text not null default '#2bdcaf' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, stage_key)
);

insert into public.pipeline_stages (owner_id, stage_key, name, color, position)
select users.id, defaults.stage_key, defaults.name, defaults.color, defaults.position
from auth.users as users
cross join (values
  ('new', 'Novo lead', '#63a9ff', 0),
  ('contacted', 'Mensagem enviada', '#7b8fa3', 1),
  ('scheduled', 'Reunião agendada', '#bd88ff', 2),
  ('completed', 'Reunião realizada', '#5dbfd0', 3),
  ('negotiation', 'Negociação', '#f6a821', 4),
  ('won', 'Venda', '#2bdcaf', 5),
  ('lost', 'Perdido', '#f36d75', 6)
) as defaults(stage_key, name, color, position)
on conflict (owner_id, stage_key) do nothing;

alter table public.leads
  drop constraint if exists leads_stage_check;

create index if not exists pipeline_stages_owner_position_idx
  on public.pipeline_stages (owner_id, position);

drop trigger if exists pipeline_stages_set_updated_at on public.pipeline_stages;
create trigger pipeline_stages_set_updated_at
before update on public.pipeline_stages
for each row execute function public.set_updated_at();

alter table public.pipeline_stages enable row level security;

create policy "pipeline_stages_select_own"
on public.pipeline_stages for select
to authenticated
using ((select auth.uid()) = owner_id);

create policy "pipeline_stages_insert_own"
on public.pipeline_stages for insert
to authenticated
with check ((select auth.uid()) = owner_id);

create policy "pipeline_stages_update_own"
on public.pipeline_stages for update
to authenticated
using ((select auth.uid()) = owner_id)
with check ((select auth.uid()) = owner_id);

create policy "pipeline_stages_delete_own"
on public.pipeline_stages for delete
to authenticated
using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.pipeline_stages to authenticated;

