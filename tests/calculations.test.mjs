import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, aggregateMetrics, deriveGoals, monthBounds, weekOfMonth } from "../calculations.js";

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
