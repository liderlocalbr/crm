create table if not exists public.lead_notes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 160),
  description text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lead_notes_owner_lead_created_idx
  on public.lead_notes (owner_id, lead_id, created_at desc);

alter table public.lead_notes enable row level security;

drop policy if exists "lead_notes_select_own" on public.lead_notes;
create policy "lead_notes_select_own" on public.lead_notes
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "lead_notes_insert_own" on public.lead_notes;
create policy "lead_notes_insert_own" on public.lead_notes
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "lead_notes_update_own" on public.lead_notes;
create policy "lead_notes_update_own" on public.lead_notes
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "lead_notes_delete_own" on public.lead_notes;
create policy "lead_notes_delete_own" on public.lead_notes
  for delete to authenticated
  using ((select auth.uid()) = owner_id);

grant select, insert, update, delete on public.lead_notes to authenticated;

drop trigger if exists lead_notes_set_updated_at on public.lead_notes;
create trigger lead_notes_set_updated_at
before update on public.lead_notes
for each row execute function public.set_updated_at();

comment on table public.lead_notes is 'Anotações independentes vinculadas aos leads do CRM.';
comment on column public.lead_notes.title is 'Título curto da anotação.';
comment on column public.lead_notes.description is 'Descrição detalhada da anotação.';

drop index if exists lead_notes_owner_lead_created_idx;
create index lead_notes_owner_lead_created_idx
  on public.lead_notes (owner_id, lead_id, created_at desc);

create or replace function public.validate_lead_note_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.leads
    where id = new.lead_id and owner_id = new.owner_id
  ) then
    raise exception 'Lead não pertence ao usuário da anotação';
  end if;
  return new;
end;
$$;

drop trigger if exists lead_notes_validate_owner on public.lead_notes;
create trigger lead_notes_validate_owner
before insert or update of lead_id, owner_id on public.lead_notes
for each row execute function public.validate_lead_note_owner();

grant usage on schema public to authenticated;
