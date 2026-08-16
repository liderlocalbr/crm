alter table public.funnel_settings
  add column if not exists whatsapp_greeting_templates jsonb not null default '[]'::jsonb,
  add column if not exists whatsapp_greeting_default_template integer not null default 0,
  add column if not exists whatsapp_greeting_randomize_templates boolean not null default false,
  add column if not exists whatsapp_greeting_template_limits jsonb not null default '{}'::jsonb,
  add column if not exists whatsapp_greeting_template_usage jsonb not null default '{}'::jsonb,
  add column if not exists whatsapp_offer_templates jsonb not null default '[]'::jsonb,
  add column if not exists whatsapp_offer_default_template integer not null default 0,
  add column if not exists whatsapp_offer_randomize_templates boolean not null default false,
  add column if not exists whatsapp_offer_template_limits jsonb not null default '{}'::jsonb,
  add column if not exists whatsapp_offer_template_usage jsonb not null default '{}'::jsonb;

update public.funnel_settings
set whatsapp_greeting_templates = case
      when whatsapp_greeting_templates = '[]'::jsonb then coalesce(whatsapp_templates, '[]'::jsonb)
      else whatsapp_greeting_templates
    end,
    whatsapp_greeting_default_template = case
      when whatsapp_greeting_templates = '[]'::jsonb then coalesce(whatsapp_default_template, 0)
      else whatsapp_greeting_default_template
    end,
    whatsapp_greeting_randomize_templates = case
      when whatsapp_greeting_templates = '[]'::jsonb then coalesce(whatsapp_randomize_templates, false)
      else whatsapp_greeting_randomize_templates
    end,
    whatsapp_greeting_template_limits = case
      when whatsapp_greeting_templates = '[]'::jsonb then coalesce(whatsapp_template_limits, '{}'::jsonb)
      else whatsapp_greeting_template_limits
    end,
    whatsapp_greeting_template_usage = case
      when whatsapp_greeting_templates = '[]'::jsonb then coalesce(whatsapp_template_usage, '{}'::jsonb)
      else whatsapp_greeting_template_usage
    end
where whatsapp_greeting_templates = '[]'::jsonb;

update public.funnel_settings
set whatsapp_offer_templates = '[{"label":"Oferta inicial","body":"{{nome}}, analisando a {{empresa}}, acredito que podemos ajudar a melhorar a presença digital e gerar mais oportunidades. Posso te mostrar como?"}]'::jsonb
where whatsapp_offer_templates = '[]'::jsonb;
