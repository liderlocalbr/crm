create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 64),
  is_default boolean not null default false,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

insert into public.pipelines (owner_id, name, is_default, position)
select users.id, 'Pipeline principal', true, 0
from auth.users as users
where not exists (
  select 1 from public.pipelines as existing where existing.owner_id = users.id
);

alter table public.pipeline_stages add column if not exists pipeline_id uuid;
alter table public.leads add column if not exists pipeline_id uuid;

update public.pipeline_stages stages
set pipeline_id = pipelines.id
from public.pipelines
where stages.owner_id = pipelines.owner_id
  and pipelines.is_default = true
  and stages.pipeline_id is null;

update public.leads leads
set pipeline_id = pipelines.id
from public.pipelines
where leads.owner_id = pipelines.owner_id
  and pipelines.is_default = true
  and leads.pipeline_id is null;

alter table public.pipeline_stages
  alter column pipeline_id set not null;
alter table public.leads
  alter column pipeline_id set not null;

alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_owner_id_stage_key_key;
alter table public.pipeline_stages
  add constraint pipeline_stages_pipeline_stage_key_unique unique (pipeline_id, stage_key);
alter table public.pipeline_stages
  add constraint pipeline_stages_pipeline_fk foreign key (pipeline_id) references public.pipelines(id) on delete cascade;

alter table public.leads
  add constraint leads_pipeline_fk foreign key (pipeline_id) references public.pipelines(id) on delete restrict;

create index if not exists pipelines_owner_position_idx on public.pipelines(owner_id, position);
create index if not exists pipeline_stages_pipeline_position_idx on public.pipeline_stages(pipeline_id, position);
create index if not exists leads_owner_pipeline_stage_idx on public.leads(owner_id, pipeline_id, stage);

drop trigger if exists pipelines_set_updated_at on public.pipelines;
create trigger pipelines_set_updated_at
before update on public.pipelines
for each row execute function public.set_updated_at();

alter table public.pipelines enable row level security;
create policy "pipelines_select_own" on public.pipelines for select to authenticated using ((select auth.uid()) = owner_id);
create policy "pipelines_insert_own" on public.pipelines for insert to authenticated with check ((select auth.uid()) = owner_id);
create policy "pipelines_update_own" on public.pipelines for update to authenticated using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy "pipelines_delete_own" on public.pipelines for delete to authenticated using ((select auth.uid()) = owner_id);

alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_pipeline_fk;
alter table public.pipeline_stages
  add constraint pipeline_stages_pipeline_fk foreign key (pipeline_id) references public.pipelines(id) on delete cascade;

grant select, insert, update, delete on public.pipelines to authenticated;

comment on table public.pipelines is 'Pipelines nomeados do CRM; cada pipeline possui seu próprio conjunto de etapas e leads.';
comment on column public.leads.pipeline_id is 'Pipeline ao qual o lead pertence.';
comment on column public.pipeline_stages.pipeline_id is 'Pipeline ao qual a etapa pertence.';

create or replace function public.ensure_single_default_pipeline()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.is_default then
    update public.pipelines set is_default = false where owner_id = new.owner_id and id <> new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists pipelines_single_default on public.pipelines;
create trigger pipelines_single_default
before insert or update of is_default on public.pipelines
for each row execute function public.ensure_single_default_pipeline();

grant usage on schema public to authenticated;
