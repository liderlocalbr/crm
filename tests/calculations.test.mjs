import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, aggregateMetrics, deriveGoals, googleCalendarEvent, googleCalendarUrl, monthBounds, moveLeadToStage, reassignStage, weekOfMonth } from "../calculations.js";

test("reproduz a projeção da planilha Métricas", () => {
  assert.deepEqual(deriveGoals(DEFAULT_SETTINGS), {
    leads: 1650,
    messages: 1485,
    meetingsScheduled: 30,
    meetingsCompleted: 12,
    negotiations: 8,
    sales: 3,
    revenue: 9000,
  });
});

test("agrega registros diários e calcula taxas reais", () => {
  const result = aggregateMetrics([
    { leads: 20, messages: 18, meetings_scheduled: 2, meetings_completed: 1, negotiations: 1, sales: 1 },
    { leads: 10, messages: 9, meetings_scheduled: 1, meetings_completed: 1, negotiations: 0, sales: 0 },
  ], 3000);
  assert.equal(result.leads, 30);
  assert.equal(result.sales, 1);
  assert.equal(result.revenue, 3000);
  assert.equal(result.rates.messageToScheduled, 3 / 27 * 100);
});

test("calcula limites do mês e semana", () => {
  assert.deepEqual(monthBounds("2026-08"), { start: "2026-08-01", end: "2026-08-31" });
  assert.equal(weekOfMonth("2026-08-01"), 1);
  assert.equal(weekOfMonth("2026-08-31"), 6);
});

test("move somente o lead arrastado para a nova etapa", () => {
  const original = [
    { id: "lead-1", name: "Clínica A", stage: "new" },
    { id: "lead-2", name: "Clínica B", stage: "contacted" },
  ];
  const result = moveLeadToStage(original, "lead-1", "scheduled");

  assert.equal(result.changed, true);
  assert.equal(result.previousStage, "new");
  assert.equal(result.lead.stage, "scheduled");
  assert.equal(result.leads[1], original[1]);
  assert.equal(original[0].stage, "new");
});

test("realoca todos os leads ao excluir uma etapa", () => {
  const original = [
    { id: "lead-1", stage: "custom" },
    { id: "lead-2", stage: "new" },
    { id: "lead-3", stage: "custom" },
  ];
  const result = reassignStage(original, "custom", "new");

  assert.equal(result.changed, 2);
  assert.deepEqual(result.leads.map((lead) => lead.stage), ["new", "new", "new"]);
  assert.equal(original[0].stage, "custom");
});

test("gera link de evento para o Google Agenda", () => {
  const url = googleCalendarUrl({
    title: "Reunião de diagnóstico",
    dueAt: "2026-08-20T13:00:00.000Z",
    details: "Lead: Clínica A",
  });

  assert.match(url, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(url, /text=Reuni%C3%A3o\+de\+diagn%C3%B3stico/);
  assert.match(url, /dates=20260820T130000Z%2F20260820T134500Z/);
});

test("gera evento para inserir pela API do Google Agenda", () => {
  const event = googleCalendarEvent({
    title: "Reunião de diagnóstico",
    dueAt: "2026-08-20T13:00:00.000Z",
    details: "Lead: Clínica A",
  });

  assert.deepEqual(event, {
    summary: "Reunião de diagnóstico",
    description: "Lead: Clínica A",
    start: { dateTime: "2026-08-20T13:00:00.000Z", timeZone: "America/Sao_Paulo" },
    end: { dateTime: "2026-08-20T13:45:00.000Z", timeZone: "America/Sao_Paulo" },
  });
});
