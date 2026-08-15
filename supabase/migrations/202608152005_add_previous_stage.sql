alter table public.leads
  add column if not exists contacted_previous_stage text;

comment on column public.leads.contacted_previous_stage is 'Etapa anterior preservada quando o lead foi marcado como contatado e avançou automaticamente.';

create index if not exists leads_contacted_previous_stage_idx
  on public.leads(owner_id, contacted_previous_stage)
  where contacted_previous_stage is not null;

-- Backfill conservador: leads já contatados não têm histórico confiável da etapa anterior.
-- Eles permanecem na etapa atual até serem desmarcados/remarcados após esta versão.
