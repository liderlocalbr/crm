alter table public.funnel_settings
  add column if not exists whatsapp_templates jsonb not null default '[]'::jsonb,
  add column if not exists whatsapp_default_template integer not null default 0,
  add column if not exists whatsapp_randomize_templates boolean not null default false,
  add column if not exists whatsapp_daily_limit integer not null default 150 check (whatsapp_daily_limit >= 0);

comment on column public.funnel_settings.whatsapp_templates is 'Biblioteca de mensagens manuais do WhatsApp; cada item possui label e body.';
comment on column public.funnel_settings.whatsapp_default_template is 'Índice do modelo padrão usado ao abrir o WhatsApp.';
comment on column public.funnel_settings.whatsapp_randomize_templates is 'Seleciona aleatoriamente um modelo configurado ao abrir o WhatsApp; não envia mensagens automaticamente.';
comment on column public.funnel_settings.whatsapp_daily_limit is 'Limite de referência diário para acompanhamento manual, sem disparo automático.';

update public.funnel_settings
set whatsapp_templates = '[{"label":"Apresentação inicial","body":"Olá, {{nome}}! Tudo bem? Aqui é {{remetente}}, da Agência Líder Local. Posso falar com você sobre uma oportunidade para {{empresa}}?"}]'::jsonb
where whatsapp_templates = '[]'::jsonb;
