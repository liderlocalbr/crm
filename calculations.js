export const DEFAULT_WHATSAPP_TEMPLATES = Object.freeze([
  { label: "Apresentação inicial", body: "Olá, {{nome}}! Tudo bem? Aqui é {{remetente}}, da Agência Líder Local. Posso falar com você sobre uma oportunidade para {{empresa}}?" },
  { label: "Mensagem objetiva", body: "Oi, {{nome}}! Tudo certo? Sou {{remetente}}, da Agência Líder Local. Gostaria de apresentar uma ideia para a {{empresa}}." },
  { label: "Contato comercial", body: "Bom dia, {{nome}}! Aqui é {{remetente}}. Estou entrando em contato porque acredito que podemos ajudar a {{empresa}} a fortalecer sua presença digital." },
  { label: "Primeiro contato", body: "Opa, {{nome}}! Tudo bem por aí? Meu nome é {{remetente}} e trabalho com soluções digitais para empresas como a {{empresa}}." },
  { label: "Convite para conversa", body: "Olá, {{nome}}! Sou {{remetente}}, da Agência Líder Local. Posso te explicar rapidamente como ajudamos empresas a gerar mais oportunidades?" },
  { label: "Abordagem consultiva", body: "Oi, {{nome}}! Tudo bem? Estou conhecendo melhor a {{empresa}} e identifiquei alguns pontos que talvez possamos melhorar juntos. Posso compartilhar?" },
  { label: "Apresentação da agência", body: "Bom dia, {{nome}}! Aqui é {{remetente}}, da Agência Líder Local. Trabalhamos com presença local e aquisição de clientes para negócios da região." },
  { label: "Mensagem cordial", body: "Olá, {{nome}}! Tudo certo? Gostaria de me apresentar: sou {{remetente}} e posso mostrar uma solução pensada para a {{empresa}}." },
]);

export const DEFAULT_SETTINGS = Object.freeze({
  deal_value: 3000,
  leads_goal: 1650,
  lead_to_message: 90,
  message_to_scheduled: 2,
  scheduled_to_completed: 40,
  completed_to_negotiation: 70,
  negotiation_to_sale: 35,
  whatsapp_templates: DEFAULT_WHATSAPP_TEMPLATES,
  whatsapp_default_template: 0,
  whatsapp_daily_limit: 150,
});

export function normalizeWhatsAppTemplates(value) {
  if (!Array.isArray(value)) return DEFAULT_WHATSAPP_TEMPLATES.map((item) => ({ ...item }));
  const templates = value.map((item, index) => ({
    label: String(item?.label || `Mensagem ${index + 1}`).trim().slice(0, 80),
    body: String(item?.body || "").trim().slice(0, 800),
  })).filter((item) => item.body);
  return templates.length ? templates : DEFAULT_WHATSAPP_TEMPLATES.map((item) => ({ ...item }));
}

export function renderWhatsAppMessage(template, lead = {}, sender = "Agência Líder Local") {
  const firstName = String(lead.name || "").trim().split(/\s+/)[0] || "tudo bem";
  const values = {
    nome: firstName,
    empresa: String(lead.company_name || lead.clinic_name || lead.name || "sua empresa").trim(),
    cidade: String(lead.city || "").trim(),
    remetente: String(sender || "Agência Líder Local").trim(),
  };
  return String(template || "").replace(/\{\{\s*(nome|empresa|cidade|remetente)\s*\}\}/gi, (_, key) => values[key.toLowerCase()] || "").replace(/\s{2,}/g, " ").trim();
}

const safeNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

export function deriveGoals(settings = DEFAULT_SETTINGS) {
  const leads = Math.max(0, Math.round(safeNumber(settings.leads_goal)));
  const messages = Math.round(leads * safeNumber(settings.lead_to_message) / 100);
  const meetingsScheduled = Math.round(messages * safeNumber(settings.message_to_scheduled) / 100);
  const meetingsCompleted = Math.round(meetingsScheduled * safeNumber(settings.scheduled_to_completed) / 100);
  const negotiations = Math.round(meetingsCompleted * safeNumber(settings.completed_to_negotiation) / 100);
  const sales = Math.round(negotiations * safeNumber(settings.negotiation_to_sale) / 100);
  const revenue = sales * Math.max(0, safeNumber(settings.deal_value));

  return { leads, messages, meetingsScheduled, meetingsCompleted, negotiations, sales, revenue };
}

export function aggregateMetrics(rows = [], dealValue = 0) {
  const total = rows.reduce((acc, row) => {
    acc.leads += safeNumber(row.leads);
    acc.messages += safeNumber(row.messages);
    acc.meetingsScheduled += safeNumber(row.meetings_scheduled);
    acc.meetingsCompleted += safeNumber(row.meetings_completed);
    acc.negotiations += safeNumber(row.negotiations);
    acc.sales += safeNumber(row.sales);
    return acc;
  }, { leads: 0, messages: 0, meetingsScheduled: 0, meetingsCompleted: 0, negotiations: 0, sales: 0 });

  total.revenue = total.sales * Math.max(0, safeNumber(dealValue));
  total.rates = {
    messageToScheduled: total.messages ? total.meetingsScheduled / total.messages * 100 : 0,
    scheduledToCompleted: total.meetingsScheduled ? total.meetingsCompleted / total.meetingsScheduled * 100 : 0,
    completedToSale: total.meetingsCompleted ? total.sales / total.meetingsCompleted * 100 : 0,
  };
  return total;
}

export function weekOfMonth(dateLike) {
  const date = new Date(`${dateLike}T12:00:00`);
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  return Math.ceil((date.getDate() + firstDay) / 7);
}

export function monthBounds(monthValue) {
  const [year, month] = String(monthValue).split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function progress(actual, goal) {
  const target = safeNumber(goal);
  return target > 0 ? Math.min(100, Math.max(0, safeNumber(actual) / target * 100)) : 0;
}

export function moveLeadToStage(leads = [], leadId, nextStage) {
  const current = leads.find((lead) => lead.id === leadId);
  if (!current || current.stage === nextStage) {
    return { leads, lead: current || null, previousStage: current?.stage || null, changed: false };
  }

  const updated = { ...current, stage: nextStage };
  return {
    leads: leads.map((lead) => lead.id === leadId ? updated : lead),
    lead: updated,
    previousStage: current.stage,
    changed: true,
  };
}

export function reassignStage(leads = [], fromStage, nextStage) {
  let changed = 0;
  const updated = leads.map((lead) => {
    if (lead.stage !== fromStage) return lead;
    changed += 1;
    return { ...lead, stage: nextStage };
  });
  return { leads: updated, changed };
}

export function normalizeWhatsAppNumber(value, countryCode = "55") {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  const normalized = digits.startsWith("0") ? digits.slice(1) : digits;
  if (normalized.startsWith(countryCode) && normalized.length >= 12) return normalized;
  if (normalized.length === 10 || normalized.length === 11) return `${countryCode}${normalized}`;
  return normalized.length >= 12 ? normalized : "";
}

export function whatsappWebUrl({ phone, message = "" } = {}) {
  const normalized = normalizeWhatsAppNumber(phone);
  if (!normalized) return "";
  const params = new URLSearchParams({ phone: normalized });
  if (message) params.set("text", message);
  return `https://web.whatsapp.com/send?${params.toString()}`;
}

export function googleCalendarUrl({ title, dueAt, details = "", durationMinutes = 45 } = {}) {
  if (!title || !dueAt) return "";
  const start = new Date(dueAt);
  if (Number.isNaN(start.getTime())) return "";
  const end = new Date(start.getTime() + Math.max(1, Number(durationMinutes) || 45) * 60_000);
  const googleDate = (date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${googleDate(start)}/${googleDate(end)}`,
    details,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function googleCalendarEvent({ title, dueAt, details = "", durationMinutes = 45 } = {}) {
  if (!title || !dueAt) return null;
  const start = new Date(dueAt);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + Math.max(1, Number(durationMinutes) || 45) * 60_000);
  return {
    summary: title,
    description: details,
    start: { dateTime: start.toISOString(), timeZone: "America/Sao_Paulo" },
    end: { dateTime: end.toISOString(), timeZone: "America/Sao_Paulo" },
  };
}

export function normalizeGoogleEvents(items = []) {
  return items
    .filter((item) => item && item.status !== "cancelled" && (item.start?.dateTime || item.start?.date))
    .map((item) => ({
      id: item.id,
      title: item.summary || "Evento sem título",
      start: item.start.dateTime || `${item.start.date}T00:00:00`,
      end: item.end?.dateTime || (item.end?.date ? `${item.end.date}T00:00:00` : null),
      allDay: Boolean(item.start.date && !item.start.dateTime),
      location: item.location || "",
      htmlLink: item.htmlLink || "",
      status: item.status || "confirmed",
    }))
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
}
