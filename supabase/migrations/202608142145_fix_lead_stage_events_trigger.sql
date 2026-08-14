drop trigger if exists leads_track_stage on public.leads;
drop function if exists public.track_lead_stage();

create or replace function public.set_lead_stage_changed_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_changed_at = now();
  end if;
  return new;
end;
$$;

create or replace function public.track_lead_stage()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.lead_stage_events (owner_id, lead_id, from_stage, to_stage, occurred_at)
    values (new.owner_id, new.id, null, new.stage, new.created_at);
  elsif new.stage is distinct from old.stage then
    insert into public.lead_stage_events (owner_id, lead_id, from_stage, to_stage, occurred_at)
    values (new.owner_id, new.id, old.stage, new.stage, now());
  end if;
  return new;
end;
$$;

create trigger leads_set_stage_changed_at
before update of stage on public.leads
for each row execute function public.set_lead_stage_changed_at();

create trigger leads_track_stage
after insert or update of stage on public.leads
for each row execute function public.track_lead_stage();
