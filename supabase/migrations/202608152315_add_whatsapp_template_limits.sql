alter table public.funnel_settings
  add column if not exists whatsapp_template_limits jsonb not null default '{}'::jsonb,
  add column if not exists whatsapp_template_usage jsonb not null default '{}'::jsonb;

comment on column public.funnel_settings.whatsapp_template_limits is 'Limite diário por índice de modelo para acompanhamento manual; não automatiza envios.';
comment on column public.funnel_settings.whatsapp_template_usage is 'Contadores manuais por data e índice de modelo, mantidos pelo CRM ao abrir o WhatsApp.';
