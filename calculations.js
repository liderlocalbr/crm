export const DEFAULT_SETTINGS = Object.freeze({
  deal_value: 3000,
  leads_goal: 1650,
  lead_to_message: 90,
  message_to_scheduled: 2,
  scheduled_to_completed: 40,
  completed_to_negotiation: 70,
  negotiation_to_sale: 35,
});

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
