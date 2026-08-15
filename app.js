import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";
import { DEFAULT_SETTINGS, aggregateMetrics, deriveGoals, googleCalendarUrl, monthBounds, moveLeadToStage, progress, reassignStage, weekOfMonth } from "./calculations.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const todayIso = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => todayIso().slice(0, 7);
const isLocalDemo = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";
const SESSION_KEY = "agencia-lider-local.crm.session.v1";
const CALENDAR_KEY = "agencia-lider-local.crm.google-calendar.v1";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast?latitude=-23.5229&longitude=-46.1883&current=temperature_2m,apparent_temperature,weather_code,is_day&timezone=America%2FSao_Paulo";
let draggedLeadId = null;
let suppressLeadClick = false;
let dashboardClockTimer = null;
let weatherRefreshTimer = null;

const DEFAULT_STAGES = [
  { value: "new", label: "Novo lead", color: "#63a9ff" },
  { value: "contacted", label: "Mensagem enviada", color: "#7b8fa3" },
  { value: "scheduled", label: "Reunião agendada", color: "#bd88ff" },
  { value: "completed", label: "Reunião realizada", color: "#5dbfd0" },
  { value: "negotiation", label: "Negociação", color: "#f6a821" },
  { value: "won", label: "Venda", color: "#2bdcaf" },
  { value: "lost", label: "Perdido", color: "#f36d75" },
];

const state = {
  authMode: "login",
  session: null,
  user: null,
  settings: { ...DEFAULT_SETTINGS },
  metrics: [],
  leads: [],
  activities: [],
  stages: DEFAULT_STAGES.map((stage, position) => ({ ...stage, position })),
  weather: null,
  weatherLoading: true,
  calendarEnabled: localStorage.getItem(CALENDAR_KEY) === "1",
  month: currentMonth(),
  week: "all",
  view: "dashboard",
  loading: false,
};

const mock = createMockData();

function createMockData() {
  const month = currentMonth();
  const sample = [
    [58, 52, 2, 1, 1, 0], [64, 58, 1, 1, 0, 0], [0, 0, 0, 0, 0, 0],
    [72, 65, 2, 1, 1, 0], [68, 61, 1, 0, 0, 0], [76, 69, 2, 1, 1, 1],
    [70, 63, 1, 1, 1, 0], [22, 20, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0],
    [81, 73, 2, 1, 1, 0], [74, 67, 1, 1, 0, 0], [79, 71, 2, 1, 1, 1],
    [66, 59, 1, 1, 1, 0], [62, 56, 1, 0, 0, 0],
  ];
  const metrics = sample.map((values, index) => ({
    id: crypto.randomUUID(), owner_id: "demo-user", metric_date: `${month}-${String(index + 1).padStart(2, "0")}`,
    leads: values[0], messages: values[1], meetings_scheduled: values[2], meetings_completed: values[3], negotiations: values[4], sales: values[5],
  }));
  const lead = (name, clinic, specialty, stage, source, followUp, value = 3000) => ({
    id: crypto.randomUUID(), owner_id: "demo-user", name, clinic_name: clinic, specialty, stage, source,
    next_follow_up: followUp, deal_value: value, whatsapp: "", email: "", notes: "", created_at: new Date().toISOString(),
  });
  const leads = [
    lead("Dra. Marina Costa", "Clínica Lumina", "Dermatologia", "new", "Meta Ads", todayIso()),
    lead("Dr. Rafael Mendes", "Instituto Revita", "Nutrologia", "contacted", "Prospecção ativa", todayIso()),
    lead("Dra. Camila Nunes", "Essence Saúde", "Endocrinologia", "scheduled", "Instagram", addDays(1)),
    lead("Dr. Bruno Alves", "Clínica Horizonte", "Medicina integrativa", "scheduled", "Indicação", addDays(2), 4500),
    lead("Dra. Lívia Rocha", "Derma Prime", "Dermatologia", "completed", "Google", todayIso()),
    lead("Dr. André Lima", "Vitta Performance", "Nutrologia", "negotiation", "Prospecção ativa", addDays(1), 5000),
    lead("Dra. Paula Torres", "Clínica Áurea", "Endocrinologia", "won", "Indicação", null, 3500),
  ];
  const activities = [
    { id: crypto.randomUUID(), lead_id: leads[1].id, kind: "whatsapp", title: "Retomar conversa sobre protocolos", due_at: `${todayIso()}T14:00:00`, completed_at: null },
    { id: crypto.randomUUID(), lead_id: leads[2].id, kind: "meeting", title: "Reunião de diagnóstico", due_at: `${addDays(1)}T10:30:00`, completed_at: null },
    { id: crypto.randomUUID(), lead_id: leads[5].id, kind: "call", title: "Alinhar proposta comercial", due_at: `${addDays(1)}T16:00:00`, completed_at: null },
    { id: crypto.randomUUID(), lead_id: leads[4].id, kind: "email", title: "Enviar estudo de caso", due_at: `${todayIso()}T09:00:00`, completed_at: new Date().toISOString() },
  ];
  return {
    settingsByMonth: new Map([[month, { ...DEFAULT_SETTINGS }]]),
    stages: DEFAULT_STAGES.map((stage, position) => ({ ...stage, id: crypto.randomUUID(), stage_key: stage.value, name: stage.label, position })),
    metrics,
    leads,
    activities,
  };
}

function addDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(Number(value) || 0));
}

function formatPercent(value) {
  return `${(Number(value) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

function formatDate(value, options = { day: "2-digit", month: "short" }) {
  if (!value) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", options).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
}

function stageMeta(value) {
  return state.stages.find((stage) => stage.value === value) || state.stages[0] || DEFAULT_STAGES[0];
}

function initials(value = "") {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "LV";
}

function toast(message, kind = "success") {
  const element = document.createElement("div");
  element.className = `toast ${kind}`;
  element.textContent = message;
  $("#toast-region").append(element);
  setTimeout(() => element.remove(), 3600);
}

async function authRequest(path, { method = "GET", body } = {}) {
  const response = await fetch(`${SUPABASE_URL}/auth/v1${path}`, {
    method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      "Content-Type": "application/json",
      ...(state.session?.access_token ? { Authorization: `Bearer ${state.session.access_token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.msg || payload?.message || payload?.error_description || "Não foi possível autenticar.");
  return payload;
}

async function rest(table, { method = "GET", query = "", body, prefer = "return=representation" } = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ""}`, {
    method,
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${state.session.access_token}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 401 && state.session?.refresh_token) {
    await refreshSession();
    return rest(table, { method, query, body, prefer });
  }
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.hint || "Falha ao acessar os dados.");
  return payload;
}

async function refreshSession() {
  const payload = await authRequest("/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: state.session.refresh_token } });
  saveSession(payload);
}

function saveSession(session) {
  state.session = session;
  state.user = session?.user || state.user;
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  state.user = null;
  localStorage.removeItem(SESSION_KEY);
}

const store = {
  async getSettings(month) {
    if (isLocalDemo) return { ...(mock.settingsByMonth.get(month) || DEFAULT_SETTINGS) };
    const goalMonth = `${month}-01`;
    const rows = await rest("funnel_settings", { query: `owner_id=eq.${state.user.id}&goal_month=eq.${goalMonth}&select=*` });
    if (rows[0]) return rows[0];
    const payload = { owner_id: state.user.id, goal_month: goalMonth, ...DEFAULT_SETTINGS };
    const created = await rest("funnel_settings", { method: "POST", query: "on_conflict=owner_id,goal_month", body: payload, prefer: "resolution=merge-duplicates,return=representation" });
    return created[0];
  },
  async saveSettings(month, settings) {
    if (isLocalDemo) {
      const value = { ...(mock.settingsByMonth.get(month) || DEFAULT_SETTINGS), ...settings };
      mock.settingsByMonth.set(month, value);
      return value;
    }
    const rows = await rest("funnel_settings", { method: "POST", query: "on_conflict=owner_id,goal_month", body: { owner_id: state.user.id, goal_month: `${month}-01`, ...settings }, prefer: "resolution=merge-duplicates,return=representation" });
    return rows[0];
  },
  async getStages() {
    if (isLocalDemo) return mock.stages.map((stage) => ({ ...stage }));
    let rows = await rest("pipeline_stages", { query: `owner_id=eq.${state.user.id}&select=*&order=position.asc` });
    if (rows.length) return rows;
    const defaults = DEFAULT_STAGES.map((stage, position) => ({ owner_id: state.user.id, stage_key: stage.value, name: stage.label, color: stage.color, position }));
    rows = await rest("pipeline_stages", { method: "POST", body: defaults });
    return rows;
  },
  async saveStage(stage) {
    if (isLocalDemo) {
      const index = mock.stages.findIndex((item) => item.id === stage.id);
      if (index >= 0) {
        mock.stages[index] = { ...mock.stages[index], ...stage };
        return mock.stages[index];
      }
      const created = { ...stage, id: crypto.randomUUID(), owner_id: "demo-user" };
      mock.stages.push(created);
      return created;
    }
    if (stage.id) {
      const { id, ...payload } = stage;
      const rows = await rest("pipeline_stages", { method: "PATCH", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, body: payload });
      return rows[0];
    }
    const rows = await rest("pipeline_stages", { method: "POST", body: { owner_id: state.user.id, ...stage } });
    return rows[0];
  },
  async deleteStage(id) {
    if (isLocalDemo) {
      mock.stages = mock.stages.filter((stage) => stage.id !== id);
      return;
    }
    await rest("pipeline_stages", { method: "DELETE", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, prefer: "return=minimal" });
  },
  async reassignStage(fromStage, nextStage) {
    if (isLocalDemo) {
      mock.leads = reassignStage(mock.leads, fromStage, nextStage).leads;
      return;
    }
    await rest("leads", { method: "PATCH", query: `owner_id=eq.${state.user.id}&stage=eq.${encodeURIComponent(fromStage)}`, body: { stage: nextStage }, prefer: "return=minimal" });
  },
  async getMetrics(month) {
    const { start, end } = monthBounds(month);
    if (isLocalDemo) return mock.metrics.filter((row) => row.metric_date >= start && row.metric_date <= end);
    return rest("daily_metrics", { query: `owner_id=eq.${state.user.id}&metric_date=gte.${start}&metric_date=lte.${end}&select=*&order=metric_date.asc` });
  },
  async upsertMetric(metric) {
    if (isLocalDemo) {
      const index = mock.metrics.findIndex((row) => row.metric_date === metric.metric_date);
      const value = { ...(index >= 0 ? mock.metrics[index] : { id: crypto.randomUUID(), owner_id: "demo-user" }), ...metric };
      index >= 0 ? mock.metrics.splice(index, 1, value) : mock.metrics.push(value);
      return value;
    }
    const rows = await rest("daily_metrics", { method: "POST", query: "on_conflict=owner_id,metric_date", body: { owner_id: state.user.id, ...metric }, prefer: "resolution=merge-duplicates,return=representation" });
    return rows[0];
  },
  async getLeads() {
    if (isLocalDemo) return [...mock.leads];
    return rest("leads", { query: `owner_id=eq.${state.user.id}&select=*&order=created_at.desc` });
  },
  async saveLead(lead) {
    if (isLocalDemo) {
      if (lead.id) {
        const index = mock.leads.findIndex((item) => item.id === lead.id);
        mock.leads[index] = { ...mock.leads[index], ...lead };
        return mock.leads[index];
      }
      const created = { ...lead, id: crypto.randomUUID(), owner_id: "demo-user", created_at: new Date().toISOString() };
      mock.leads.unshift(created);
      return created;
    }
    if (lead.id) {
      const { id, ...payload } = lead;
      const rows = await rest("leads", { method: "PATCH", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, body: payload });
      return rows[0];
    }
    const rows = await rest("leads", { method: "POST", body: { owner_id: state.user.id, ...lead } });
    return rows[0];
  },
  async deleteLead(id) {
    if (isLocalDemo) {
      mock.leads = mock.leads.filter((lead) => lead.id !== id);
      mock.activities = mock.activities.filter((activity) => activity.lead_id !== id);
      return;
    }
    await rest("leads", { method: "DELETE", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, prefer: "return=minimal" });
  },
  async getActivities() {
    if (isLocalDemo) return [...mock.activities];
    return rest("activities", { query: `owner_id=eq.${state.user.id}&select=*&order=due_at.asc.nullslast` });
  },
  async saveActivity(activity) {
    if (isLocalDemo) {
      const created = { ...activity, id: crypto.randomUUID(), owner_id: "demo-user", created_at: new Date().toISOString() };
      mock.activities.push(created);
      return created;
    }
    const rows = await rest("activities", { method: "POST", body: { owner_id: state.user.id, ...activity } });
    return rows[0];
  },
  async toggleActivity(id, completed) {
    const completed_at = completed ? new Date().toISOString() : null;
    if (isLocalDemo) {
      const item = mock.activities.find((activity) => activity.id === id);
      item.completed_at = completed_at;
      return item;
    }
    const rows = await rest("activities", { method: "PATCH", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, body: { completed_at } });
    return rows[0];
  },
};

async function bootstrap() {
  setupStaticEvents();
  populateStageOptions();
  if (isLocalDemo) {
    state.session = { access_token: "demo" };
    state.user = { id: "demo-user", email: "demo@agencialiderlocal.com.br", user_metadata: { full_name: "Damião Moreira" } };
    await enterApp();
    return;
  }
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (saved?.access_token) {
      state.session = saved;
      const user = await authRequest("/user");
      state.user = user;
      await enterApp();
      return;
    }
  } catch {
    clearSession();
  }
  showAuth();
}

function setupStaticEvents() {
  $("#auth-toggle").addEventListener("click", () => {
    state.authMode = state.authMode === "login" ? "signup" : "login";
    renderAuthMode();
  });
  $("#auth-form").addEventListener("submit", handleAuth);
  $("#logout-button").addEventListener("click", logout);
  $("#main-nav").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (button) navigate(button.dataset.view);
  });
  $("#mobile-menu-button").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  $$(".modal-close").forEach((button) => button.addEventListener("click", () => $("#lead-dialog").close()));
  $$(".activity-close").forEach((button) => button.addEventListener("click", () => $("#activity-dialog").close()));
  $$(".stage-close").forEach((button) => button.addEventListener("click", () => $("#stage-dialog").close()));
  $("#lead-form").addEventListener("submit", saveLeadFromDialog);
  $("#delete-lead").addEventListener("click", deleteCurrentLead);
  $("#activity-form").addEventListener("submit", saveActivityFromDialog);
  $("#stage-add-form").addEventListener("submit", addPipelineStage);
  $("#stage-dialog").addEventListener("click", handleStageDialogClick);
  $(".main-content").addEventListener("click", handleMainClick);
  $(".main-content").addEventListener("change", handleMainChange);
  $(".main-content").addEventListener("input", handleMainInput);
  $(".main-content").addEventListener("dragstart", handleLeadDragStart);
  $(".main-content").addEventListener("dragover", handleLeadDragOver);
  $(".main-content").addEventListener("dragleave", handleLeadDragLeave);
  $(".main-content").addEventListener("drop", handleLeadDrop);
  $(".main-content").addEventListener("dragend", handleLeadDragEnd);
}

function populateStageOptions() {
  $("#lead-stage").innerHTML = state.stages.map((stage) => `<option value="${stage.value}">${escapeHtml(stage.label)}</option>`).join("");
}

function renderAuthMode() {
  const signup = state.authMode === "signup";
  $("#name-field").classList.toggle("hidden", !signup);
  $("#auth-title").textContent = signup ? "Crie seu acesso" : "Entre no seu painel";
  $("#auth-subtitle").textContent = signup ? "Comece com as metas da planilha já configuradas." : "Use seu e-mail e senha para continuar.";
  $("#auth-submit").textContent = signup ? "Criar minha conta" : "Entrar no CRM";
  $("#auth-toggle").textContent = signup ? "Já tenho conta — entrar" : "Primeiro acesso? Criar conta";
  $("#auth-password").autocomplete = signup ? "new-password" : "current-password";
  $("#auth-message").textContent = "";
}

async function handleAuth(event) {
  event.preventDefault();
  const submit = $("#auth-submit");
  const message = $("#auth-message");
  submit.disabled = true;
  submit.textContent = "Aguarde…";
  message.textContent = "";
  try {
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    if (state.authMode === "signup") {
      const payload = await authRequest("/signup", { method: "POST", body: { email, password, data: { full_name: $("#auth-name").value.trim() || email.split("@")[0] } } });
      if (!payload.access_token) {
        state.authMode = "login";
        renderAuthMode();
        message.textContent = "Conta criada. Abra o e-mail de confirmação (verifique também a pasta Spam) e depois entre no CRM.";
        return;
      }
      saveSession(payload);
    } else {
      const payload = await authRequest("/token?grant_type=password", { method: "POST", body: { email, password } });
      saveSession(payload);
    }
    await enterApp();
  } catch (error) {
    message.textContent = translateAuthError(error.message);
  } finally {
    submit.disabled = false;
    submit.textContent = state.authMode === "signup" ? "Criar minha conta" : "Entrar no CRM";
  }
}

function translateAuthError(message) {
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha incorretos.";
  if (/email not confirmed/i.test(message)) return "Confirme seu e-mail antes de entrar. Verifique também a pasta Spam.";
  if (/email rate limit exceeded|over_email_send_rate_limit/i.test(message)) return "Muitas tentativas de envio. Aguarde alguns minutos e use o e-mail de confirmação já recebido.";
  if (/user already registered/i.test(message)) return "Este e-mail já possui uma conta.";
  if (/password/i.test(message)) return "A senha precisa ter pelo menos 6 caracteres.";
  return message;
}

function showAuth() {
  $("#auth-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
}

async function enterApp() {
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  const name = state.user.user_metadata?.full_name || state.user.email?.split("@")[0] || "Usuário";
  $("#user-name").textContent = name;
  $("#user-email").textContent = state.user.email || "Modo demonstração";
  $("#user-avatar").textContent = initials(name);
  state.loading = true;
  renderAll();
  try {
    await loadData();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.loading = false;
    renderAll();
    populateStageOptions();
    startDashboardWidgets();
  }
}

async function loadData() {
  const [settings, metrics, leads, activities, stages] = await Promise.all([
    store.getSettings(state.month), store.getMetrics(state.month), store.getLeads(), store.getActivities(), store.getStages(),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  state.metrics = metrics;
  state.leads = leads;
  state.activities = activities;
  state.stages = stages.map((stage) => ({ ...stage, value: stage.stage_key, label: stage.name }));
}

async function reloadPeriod() {
  const [settings, metrics] = await Promise.all([store.getSettings(state.month), store.getMetrics(state.month)]);
  state.settings = { ...DEFAULT_SETTINGS, ...settings };
  state.metrics = metrics;
  renderDashboard();
  renderMetrics();
  renderGoals();
  updateDashboardWidgets();
}

async function logout() {
  try { if (!isLocalDemo) await authRequest("/logout", { method: "POST" }); } catch { /* local session is still cleared */ }
  clearSession();
  location.href = location.pathname;
}

function navigate(view) {
  state.view = view;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((section) => section.classList.toggle("active-view", section.id === `view-${view}`));
  $(".sidebar").classList.remove("open");
}

function renderAll() {
  if (state.loading) {
    $$(".view").forEach((view) => { view.innerHTML = `<div class="loading">Sincronizando sua órbita…</div>`; });
    return;
  }
  renderDashboard();
  renderLeads();
  renderMetrics();
  renderAgenda();
  renderGoals();
}

function pageHead(eyebrow, title, subtitle, actions = "") {
  return `<header class="page-head"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${subtitle}</p></div><div class="head-actions">${actions}</div></header>`;
}

function monthInput(id) {
  return `<input id="${id}" class="compact-input" type="month" value="${state.month}" aria-label="Escolher mês" />`;
}

function metricRowsForFilter() {
  if (state.week === "all") return state.metrics;
  return state.metrics.filter((row) => weekOfMonth(row.metric_date) === Number(state.week));
}

function startDashboardWidgets() {
  clearInterval(dashboardClockTimer);
  clearInterval(weatherRefreshTimer);
  updateDashboardWidgets();
  dashboardClockTimer = setInterval(updateDashboardWidgets, 1000);
  loadWeather();
  weatherRefreshTimer = setInterval(loadWeather, 15 * 60 * 1000);
}

function updateDashboardWidgets() {
  const time = $("#dashboard-clock-time");
  const date = $("#dashboard-clock-date");
  if (time) time.textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date());
  if (date) date.textContent = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long" }).format(new Date());
  const weatherTemp = $("#weather-temperature");
  const weatherSummary = $("#weather-summary");
  const weatherFeels = $("#weather-feels");
  if (weatherTemp) weatherTemp.textContent = state.weather ? `${Math.round(state.weather.temperature_2m)}°C` : "--°C";
  if (weatherSummary) weatherSummary.textContent = state.weather ? weatherCodeLabel(state.weather.weather_code) : state.weatherLoading ? "Atualizando clima…" : "Clima indisponível";
  if (weatherFeels) weatherFeels.textContent = state.weather ? `Sensação de ${Math.round(state.weather.apparent_temperature)}°C` : "CEP 08771-264";
}

async function loadWeather() {
  state.weatherLoading = true;
  updateDashboardWidgets();
  try {
    const response = await fetch(WEATHER_URL);
    if (!response.ok) throw new Error("Falha ao consultar o clima.");
    const payload = await response.json();
    state.weather = payload.current || null;
  } catch {
    state.weather = null;
  } finally {
    state.weatherLoading = false;
    updateDashboardWidgets();
  }
}

function weatherCodeLabel(code) {
  if (code === 0) return "Céu limpo";
  if ([1, 2].includes(code)) return "Poucas nuvens";
  if (code === 3) return "Nublado";
  if ([45, 48].includes(code)) return "Neblina";
  if ([51, 53, 55, 56, 57].includes(code)) return "Garoa";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Chuva";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Neve";
  if ([95, 96, 99].includes(code)) return "Tempestade";
  return "Tempo variável";
}

function renderDashboard() {
  const rows = metricRowsForFilter();
  const totals = aggregateMetrics(rows, state.settings.deal_value);
  const goals = deriveGoals(state.settings);
  const salesProgress = progress(totals.sales, goals.sales);
  const greeting = new Date().getHours() < 12 ? "Bom dia" : new Date().getHours() < 18 ? "Boa tarde" : "Boa noite";
  const name = (state.user?.user_metadata?.full_name || state.user?.email?.split("@")[0] || "").split(" ")[0];
  const allStages = [
    ["Leads", totals.leads, goals.leads], ["Mensagens", totals.messages, goals.messages],
    ["Reuniões agendadas", totals.meetingsScheduled, goals.meetingsScheduled], ["Reuniões realizadas", totals.meetingsCompleted, goals.meetingsCompleted],
    ["Negociação", totals.negotiations, goals.negotiations], ["Vendas", totals.sales, goals.sales],
  ];
  const maxGoal = Math.max(1, ...allStages.map((item) => item[2]));
  const recentLeads = state.leads.slice(0, 5);
  const monthLabel = formatDate(`${state.month}-01`, { month: "long", year: "numeric" });

  $("#view-dashboard").innerHTML = `
    ${pageHead("PAINEL DE ÓRBITA", `${greeting}, ${escapeHtml(name)}.`, `Acompanhe o ritmo comercial de ${monthLabel}.`, `
      <div class="filters">${monthInput("dashboard-month")}<select id="dashboard-week" class="compact-select"><option value="all">Todas as semanas</option>${[1,2,3,4,5,6].map((w) => `<option value="${w}" ${state.week === String(w) ? "selected" : ""}>Semana ${w}</option>`).join("")}</select></div>
      <button class="button primary" data-action="open-lead">+ Novo lead</button>`)}
    <div class="dashboard-status">
      <article class="status-card clock-card"><span class="status-icon">◷</span><div><strong id="dashboard-clock-time">--:--:--</strong><span id="dashboard-clock-date">Horário de Brasília</span></div></article>
      <article class="status-card weather-card"><span class="status-icon">☼</span><div><strong id="weather-temperature">--°C</strong><span><b id="weather-summary">Atualizando clima…</b> · <span id="weather-feels">CEP 08771-264</span></span></div><small>Mogi das Cruzes · SP</small></article>
    </div>
    <div class="kpi-grid">
      ${kpi("Leads no período", totals.leads, goals.leads, "◎", progress(totals.leads, goals.leads))}
      ${kpi("Reuniões realizadas", totals.meetingsCompleted, goals.meetingsCompleted, "◷", progress(totals.meetingsCompleted, goals.meetingsCompleted))}
      ${kpi("Vendas", totals.sales, goals.sales, "◇", salesProgress)}
      ${kpi("Receita estimada", formatCurrency(totals.revenue), formatCurrency(goals.revenue), "↗", progress(totals.revenue, goals.revenue), true)}
    </div>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head"><div><h2>Funil realizado</h2><span>Meta encadeada pelas taxas de conversão</span></div><span>${formatNumber(totals.leads)} entradas</span></div>
        <div class="funnel">${allStages.map(([label, actual, goal], index) => `
          <div class="funnel-row"><div class="funnel-label">${label}<small>meta ${formatNumber(goal)}</small></div><div class="funnel-track"><div class="funnel-fill" style="width:${Math.max(actual ? 2 : 0, actual / maxGoal * 100)}%"></div></div><div class="funnel-value">${formatNumber(actual)}</div></div>`).join("")}</div>
        <div class="real-rates">
          <div class="rate-tile"><span>Mensagem → agendada</span><b>${formatPercent(totals.rates.messageToScheduled)}</b></div>
          <div class="rate-tile"><span>Agendada → realizada</span><b>${formatPercent(totals.rates.scheduledToCompleted)}</b></div>
          <div class="rate-tile"><span>Realizada → venda</span><b>${formatPercent(totals.rates.completedToSale)}</b></div>
        </div>
      </section>
      <section class="panel goal-card">
        <div class="panel-head"><div><h2>Meta de receita</h2><span>Setup + MRR atual: ${formatCurrency(state.settings.deal_value)}</span></div><span>${formatNumber(totals.sales)} / ${formatNumber(goals.sales)} vendas</span></div>
        <div class="goal-amount">${formatCurrency(goals.revenue)}</div><div class="goal-caption">Receita projetada com a meta atual</div>
        <div class="goal-ring-row"><div class="goal-ring" style="--p:${salesProgress}"><b>${Math.round(salesProgress)}%</b></div><div class="goal-list"><div><span>Realizado</span><b>${formatCurrency(totals.revenue)}</b></div><div><span>Faltam</span><b>${formatCurrency(Math.max(0, goals.revenue - totals.revenue))}</b></div><div><span>Conversão final</span><b>${formatPercent(state.settings.negotiation_to_sale)}</b></div></div></div>
        <button class="button ghost wide" data-view-target="goals">Ajustar metas e taxas</button>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Leads recentes</h2><span>Últimas oportunidades adicionadas</span></div><button class="text-button" data-view-target="leads">Ver pipeline</button></div>
        ${recentLeads.length ? `<div class="list">${recentLeads.map(leadListRow).join("")}</div>` : emptyState("◎", "Seu pipeline está vazio", "Adicione o primeiro lead para começar a acompanhar as oportunidades.", `<button class="button primary small" data-action="open-lead">Novo lead</button>`) }
      </section>
      <section class="panel">
        <div class="panel-head"><div><h2>Próximos passos</h2><span>Follow-ups ainda não concluídos</span></div><button class="text-button" data-view-target="agenda">Abrir agenda</button></div>
        ${upcomingActivities(4)}
      </section>
    </div>`;
  updateDashboardWidgets();
}

function kpi(label, value, goal, icon, percentage, currency = false) {
  return `<article class="kpi-card" style="--glow:${currency ? "rgba(246,168,33,.08)" : "rgba(43,220,175,.07)"}"><div class="kpi-top"><span>${label}</span><i class="kpi-icon">${icon}</i></div><h3>${typeof value === "number" ? formatNumber(value) : value}</h3><div class="kpi-foot"><span>Meta: ${typeof goal === "number" && !currency ? formatNumber(goal) : goal}</span><span class="mini-progress"><i style="width:${percentage}%"></i></span></div></article>`;
}

function leadListRow(lead) {
  const stage = stageMeta(lead.stage);
  return `<button class="list-row" data-action="edit-lead" data-id="${lead.id}" style="border-left:0;border-right:0;border-top:0;background:transparent;color:inherit;width:100%;text-align:left;cursor:pointer"><span class="list-avatar">${initials(lead.name)}</span><span class="list-main"><b>${escapeHtml(lead.name)}</b><span>${escapeHtml(lead.clinic_name || lead.specialty || lead.source || "Sem detalhes")}</span></span><span class="stage-badge ${lead.stage}">${stage.label}</span></button>`;
}

function upcomingActivities(limit) {
  const rows = state.activities.filter((activity) => !activity.completed_at).slice().sort((a, b) => String(a.due_at || "9999").localeCompare(String(b.due_at || "9999"))).slice(0, limit);
  if (!rows.length) return emptyState("◷", "Agenda em dia", "Crie uma atividade para não perder o próximo passo.", `<button class="button primary small" data-action="open-activity">Nova atividade</button>`);
  return `<div class="list">${rows.map((activity) => {
    const lead = state.leads.find((item) => item.id === activity.lead_id);
    return `<div class="list-row"><button class="activity-check" data-action="toggle-activity" data-id="${activity.id}" aria-label="Concluir atividade"></button><span class="list-main"><b>${escapeHtml(activity.title)}</b><span>${escapeHtml(lead?.name || "Atividade geral")}</span></span><span class="activity-time ${isOverdue(activity) ? "overdue" : ""}">${activity.due_at ? formatDate(activity.due_at) : "Sem prazo"}</span></div>`;
  }).join("")}</div>`;
}

function renderLeads() {
  $("#view-leads").innerHTML = `
    ${pageHead("PIPELINE COMERCIAL", "Oportunidades em movimento", "Arraste os cards e personalize as etapas de acordo com seu processo.", `<span class="date-chip">${state.leads.length} leads</span><button class="button ghost" data-action="manage-stages">⚙ Etapas</button><button class="button primary" data-action="open-lead">+ Novo lead</button>`)}
    <div class="kanban">${state.stages.map((stage) => {
      const leads = state.leads.filter((lead) => lead.stage === stage.value);
      return `<section class="kanban-column" data-drop-stage="${stage.value}"><div class="kanban-head"><span><i style="--column-color:${stage.color}"></i>${escapeHtml(stage.label)}</span><b class="kanban-count">${leads.length}</b></div><div class="kanban-cards">${leads.length ? leads.map(leadCard).join("") : `<div class="empty-column">Solte um lead nesta etapa</div>`}</div></section>`;
    }).join("")}</div>`;
}

function leadCard(lead) {
  const overdue = lead.next_follow_up && lead.next_follow_up < todayIso();
  return `<article class="lead-card" draggable="true" data-action="edit-lead" data-id="${lead.id}" title="Arraste para mudar de etapa ou clique para editar"><div class="lead-card-top"><div><h3>${escapeHtml(lead.name)}</h3><p>${escapeHtml(lead.clinic_name || lead.specialty || "Sem clínica informada")}</p></div><span class="lead-card-value">${formatCurrency(lead.deal_value || state.settings.deal_value)}</span></div><div class="lead-meta"><span>${escapeHtml(lead.source || "Sem origem")}</span><span class="lead-follow-up ${overdue ? "overdue" : ""}">${lead.next_follow_up ? `Follow-up ${formatDate(lead.next_follow_up)}` : "Sem follow-up"}</span></div></article>`;
}

function openStageDialog() {
  renderStageManager();
  $("#new-stage-name").value = "";
  $("#stage-dialog").showModal();
}

function renderStageManager() {
  $("#stage-list").innerHTML = state.stages.map((stage, index) => {
    const leadCount = state.leads.filter((lead) => lead.stage === stage.value).length;
    return `<div class="stage-editor" data-stage-id="${stage.id}">
      <span class="stage-order">${index + 1}</span>
      <input class="stage-color" data-stage-color type="color" value="${stage.color || "#2bdcaf"}" aria-label="Cor da etapa ${escapeHtml(stage.label)}" />
      <label class="field"><span>Nome da etapa</span><input data-stage-name maxlength="48" value="${escapeHtml(stage.label)}" /></label>
      <span class="stage-lead-count">${leadCount} ${leadCount === 1 ? "lead" : "leads"}</span>
      <button class="button small" data-stage-action="save" type="button">Salvar</button>
      <button class="icon-button danger-icon" data-stage-action="delete" type="button" aria-label="Excluir ${escapeHtml(stage.label)}">×</button>
    </div>`;
  }).join("");
}

async function handleStageDialogClick(event) {
  const button = event.target.closest("[data-stage-action]");
  if (!button) return;
  const row = button.closest("[data-stage-id]");
  const stage = state.stages.find((item) => item.id === row?.dataset.stageId);
  if (!stage) return;
  if (button.dataset.stageAction === "save") {
    const name = row.querySelector("[data-stage-name]").value.trim();
    const color = row.querySelector("[data-stage-color]").value;
    if (!name) return toast("Digite um nome para a etapa.", "error");
    button.disabled = true;
    try {
      const saved = await store.saveStage({ id: stage.id, name, color });
      Object.assign(stage, { ...saved, label: saved.name || name, color });
      populateStageOptions();
      renderLeads();
      renderStageManager();
      toast("Etapa atualizada.");
    } catch (error) {
      button.disabled = false;
      toast(error.message, "error");
    }
  }
  if (button.dataset.stageAction === "delete") await deletePipelineStage(stage);
}

async function addPipelineStage(event) {
  event.preventDefault();
  const name = $("#new-stage-name").value.trim();
  if (!name) return;
  const submit = event.submitter;
  submit.disabled = true;
  try {
    const created = await store.saveStage({
      stage_key: `custom_${crypto.randomUUID().replaceAll("-", "")}`,
      name,
      color: $("#new-stage-color").value,
      position: state.stages.length,
    });
    state.stages.push({ ...created, value: created.stage_key, label: created.name });
    populateStageOptions();
    renderLeads();
    renderStageManager();
    event.target.reset();
    $("#new-stage-color").value = "#2bdcaf";
    toast("Nova etapa adicionada ao pipeline.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
  }
}

async function deletePipelineStage(stage) {
  if (state.stages.length <= 1) return toast("O pipeline precisa ter pelo menos uma etapa.", "error");
  const currentIndex = state.stages.findIndex((item) => item.id === stage.id);
  const fallback = state.stages[currentIndex + 1] || state.stages[currentIndex - 1];
  const affected = state.leads.filter((lead) => lead.stage === stage.value).length;
  const detail = affected ? ` Os ${affected} ${affected === 1 ? "lead será movido" : "leads serão movidos"} para “${fallback.label}”.` : "";
  if (!confirm(`Excluir a etapa “${stage.label}”?${detail}`)) return;
  try {
    if (affected) await store.reassignStage(stage.value, fallback.value);
    await store.deleteStage(stage.id);
    state.leads = reassignStage(state.leads, stage.value, fallback.value).leads;
    state.stages = state.stages.filter((item) => item.id !== stage.id);
    populateStageOptions();
    renderDashboard();
    renderLeads();
    renderStageManager();
    toast("Etapa excluída.");
  } catch (error) {
    toast(error.message, "error");
  }
}

function clearLeadDragVisuals() {
  $$(".lead-card.dragging").forEach((card) => card.classList.remove("dragging"));
  $$(".kanban-column.drop-target").forEach((column) => column.classList.remove("drop-target"));
}

function handleLeadDragStart(event) {
  const card = event.target.closest(".lead-card[data-id]");
  if (!card) return;
  draggedLeadId = card.dataset.id;
  suppressLeadClick = true;
  card.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedLeadId);
}

function handleLeadDragOver(event) {
  const column = event.target.closest("[data-drop-stage]");
  if (!column || !draggedLeadId) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  $$(".kanban-column.drop-target").forEach((item) => item.classList.toggle("drop-target", item === column));
}

function handleLeadDragLeave(event) {
  const column = event.target.closest("[data-drop-stage]");
  if (column && !column.contains(event.relatedTarget)) column.classList.remove("drop-target");
}

async function handleLeadDrop(event) {
  const column = event.target.closest("[data-drop-stage]");
  if (!column) return;
  event.preventDefault();
  const leadId = draggedLeadId || event.dataTransfer.getData("text/plain");
  const nextStage = column.dataset.dropStage;
  clearLeadDragVisuals();
  draggedLeadId = null;
  setTimeout(() => { suppressLeadClick = false; }, 0);
  const movement = moveLeadToStage(state.leads, leadId, nextStage);
  if (!movement.changed) return;

  state.leads = movement.leads;
  renderDashboard();
  renderLeads();
  try {
    await store.saveLead({ id: movement.lead.id, stage: nextStage });
    toast(`${movement.lead.name} movido para ${stageMeta(nextStage).label}.`);
  } catch (error) {
    state.leads = moveLeadToStage(state.leads, movement.lead.id, movement.previousStage).leads;
    renderDashboard();
    renderLeads();
    toast(error.message || "Não foi possível mover o lead.", "error");
  }
}

function handleLeadDragEnd() {
  clearLeadDragVisuals();
  draggedLeadId = null;
  setTimeout(() => { suppressLeadClick = false; }, 0);
}

function renderMetrics() {
  const { start, end } = monthBounds(state.month);
  const existing = new Map(state.metrics.map((row) => [row.metric_date, row]));
  const dates = [];
  for (let day = new Date(`${start}T12:00:00`); day <= new Date(`${end}T12:00:00`); day.setDate(day.getDate() + 1)) {
    const key = day.toISOString().slice(0, 10);
    dates.push(existing.get(key) || { metric_date: key, leads: 0, messages: 0, meetings_scheduled: 0, meetings_completed: 0, negotiations: 0, sales: 0 });
  }
  const total = aggregateMetrics(dates, state.settings.deal_value);
  $("#view-metrics").innerHTML = `
    ${pageHead("REGISTRO DIÁRIO", "A rotina que alimenta o painel", "Edite os números do dia e acompanhe o fechamento semanal e mensal.", `${monthInput("metrics-month")}<span class="date-chip">Salvamento por linha</span>`)}
    <div class="table-wrap"><table class="data-table"><thead><tr><th>Data</th><th>Semana</th><th>Leads</th><th>Mensagens</th><th>Agendadas</th><th>Realizadas</th><th>Negociação</th><th>Vendas</th><th>Receita</th><th></th></tr></thead><tbody>
      ${dates.map((row) => metricTableRow(row)).join("")}
      <tr class="table-total"><td>TOTAL DO MÊS</td><td></td><td>${formatNumber(total.leads)}</td><td>${formatNumber(total.messages)}</td><td>${formatNumber(total.meetingsScheduled)}</td><td>${formatNumber(total.meetingsCompleted)}</td><td>${formatNumber(total.negotiations)}</td><td>${formatNumber(total.sales)}</td><td>${formatCurrency(total.revenue)}</td><td></td></tr>
    </tbody></table></div>`;
}

function metricTableRow(row) {
  const fields = ["leads", "messages", "meetings_scheduled", "meetings_completed", "negotiations", "sales"];
  return `<tr data-metric-date="${row.metric_date}"><td class="metric-date">${formatDate(row.metric_date, { day: "2-digit", month: "2-digit", weekday: "short" })}</td><td><span class="week-tag">S${weekOfMonth(row.metric_date)}</span></td>${fields.map((field) => `<td><input class="metric-input" data-field="${field}" type="number" min="0" value="${Number(row[field]) || 0}" aria-label="${field}" /></td>`).join("")}<td data-revenue>${formatCurrency((Number(row.sales) || 0) * state.settings.deal_value)}</td><td><button class="button small save-row" data-action="save-metric">Salvar</button></td></tr>`;
}

function renderAgenda() {
  const open = state.activities.filter((activity) => !activity.completed_at).sort((a, b) => String(a.due_at || "9999").localeCompare(String(b.due_at || "9999")));
  const done = state.activities.filter((activity) => activity.completed_at).sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at)));
  const overdue = open.filter(isOverdue).length;
  const today = open.filter((activity) => activity.due_at?.slice(0,10) === todayIso()).length;
  $("#view-agenda").innerHTML = `
    ${pageHead("AGENDA COMERCIAL", "Próximos passos", "Follow-ups, reuniões e contatos organizados por prazo.", `<button class="button google-button ${state.calendarEnabled ? "connected" : ""}" data-action="connect-google-calendar">${state.calendarEnabled ? "✓ Google Agenda ativo" : "G Conectar Google Agenda"}</button><button class="button primary" data-action="open-activity">+ Nova atividade</button>`)}
    <div class="agenda-layout"><section class="panel">
      <div class="agenda-group"><h2 class="agenda-group-title">PENDENTES · ${open.length}</h2>${open.length ? open.map(activityRow).join("") : emptyState("✓", "Nenhuma pendência", "Sua agenda está limpa. Crie uma atividade quando definir o próximo passo.", "")}</div>
      ${done.length ? `<div class="agenda-group"><h2 class="agenda-group-title">CONCLUÍDAS · ${done.length}</h2>${done.slice(0,8).map(activityRow).join("")}</div>` : ""}
    </section><aside class="panel"><div class="panel-head"><div><h2>Resumo da agenda</h2><span>Prioridades atuais</span></div></div><div class="agenda-summary"><div class="summary-tile"><span>Para hoje</span><b>${today}</b></div><div class="summary-tile"><span>Em atraso</span><b style="color:${overdue ? "var(--red)" : "var(--green)"}">${overdue}</b></div><div class="summary-tile"><span>Concluídas</span><b>${done.length}</b></div></div></aside></div>`;
}

function isOverdue(activity) {
  return !activity.completed_at && activity.due_at && new Date(activity.due_at) < new Date();
}

function activityRow(activity) {
  const lead = state.leads.find((item) => item.id === activity.lead_id);
  const calendarUrl = googleCalendarUrl({ title: activity.title, dueAt: activity.due_at, details: `CRM Agência Líder Local\nLead: ${lead?.name || "Atividade geral"}\nTipo: ${activityKindLabel(activity.kind)}` });
  return `<div class="activity-row"><button class="activity-check ${activity.completed_at ? "done" : ""}" data-action="toggle-activity" data-id="${activity.id}" aria-label="${activity.completed_at ? "Reabrir" : "Concluir"} atividade"></button><div class="activity-main"><b>${escapeHtml(activity.title)}</b><span>${escapeHtml(lead?.name || "Atividade geral")} · ${activityKindLabel(activity.kind)}</span>${state.calendarEnabled && calendarUrl ? `<a class="calendar-link" href="${calendarUrl}" target="_blank" rel="noopener">Adicionar ao Google Agenda ↗</a>` : ""}</div><span class="activity-time ${isOverdue(activity) ? "overdue" : ""}">${activity.due_at ? formatDate(activity.due_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sem prazo"}</span></div>`;
}

function activityKindLabel(value) {
  return ({ call: "Ligação", whatsapp: "WhatsApp", email: "E-mail", meeting: "Reunião", follow_up: "Follow-up", note: "Nota" })[value] || "Atividade";
}

function renderGoals() {
  const goals = deriveGoals(state.settings);
  const monthLabel = formatDate(`${state.month}-01`, { month: "long", year: "numeric" });
  $("#view-goals").innerHTML = `
    ${pageHead("METAS E CONVERSÕES", `Metas de ${monthLabel}`, "Cada mês possui metas próprias. Ao alterar um número, todo o funil é recalculado automaticamente.", `${monthInput("goals-month")}<span class="date-chip">Meta mensal</span>`)}
    <div class="goals-layout"><section class="panel"><div class="panel-head"><div><h2>Premissas do mês</h2><span>Percentuais em escala de 0 a 100</span></div></div><form id="goals-form" class="goal-form">
      ${goalInput("leads_goal", "Meta de leads", state.settings.leads_goal, 1)}
      ${goalInput("deal_value", "Setup + MRR (R$)", state.settings.deal_value, 100)}
      ${goalInput("lead_to_message", "Leads → mensagem (%)", state.settings.lead_to_message, .1)}
      ${goalInput("message_to_scheduled", "Mensagem → agendada (%)", state.settings.message_to_scheduled, .1)}
      ${goalInput("scheduled_to_completed", "Agendada → realizada (%)", state.settings.scheduled_to_completed, .1)}
      ${goalInput("completed_to_negotiation", "Realizada → negociação (%)", state.settings.completed_to_negotiation, .1)}
      ${goalInput("negotiation_to_sale", "Negociação → venda (%)", state.settings.negotiation_to_sale, .1)}
      <button class="button primary span-2" type="submit">Salvar metas e taxas</button>
    </form></section><section class="panel"><div class="panel-head"><div><h2>Resultado projetado</h2><span>Atualização instantânea</span></div></div><div id="projection-flow" class="projection-flow">${projectionRows(goals)}</div></section></div>`;
  $("#goals-form").addEventListener("submit", saveGoals);
}

function goalInput(name, label, value, step) {
  return `<label class="field"><span>${label}</span><input data-goal-field="${name}" type="number" min="0" ${name !== "deal_value" && name !== "leads_goal" ? "max=100" : ""} step="${step}" value="${Number(value)}" /></label>`;
}

function projectionRows(goals) {
  return [
    ["Leads de entrada", goals.leads], ["Mensagens", goals.messages], ["Reuniões agendadas", goals.meetingsScheduled],
    ["Reuniões realizadas", goals.meetingsCompleted], ["Negociações", goals.negotiations], ["Vendas", goals.sales],
  ].map(([label, value]) => `<div class="projection-row"><span>${label}</span><b>${formatNumber(value)}</b></div>`).join("") + `<div class="projection-row final"><span>Receita projetada</span><b>${formatCurrency(goals.revenue)}</b></div>`;
}

function emptyState(icon, title, text, action) {
  return `<div class="empty-state"><div><i>${icon}</i><h3>${title}</h3><p>${text}</p>${action}</div></div>`;
}

async function handleMainClick(event) {
  const viewTarget = event.target.closest("[data-view-target]");
  if (viewTarget) return navigate(viewTarget.dataset.viewTarget);
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (suppressLeadClick && action.dataset.action === "edit-lead") return;
  if (action.dataset.action === "open-lead") openLeadDialog();
  if (action.dataset.action === "edit-lead") openLeadDialog(state.leads.find((lead) => lead.id === action.dataset.id));
  if (action.dataset.action === "open-activity") openActivityDialog();
  if (action.dataset.action === "manage-stages") openStageDialog();
  if (action.dataset.action === "connect-google-calendar") connectGoogleCalendar();
  if (action.dataset.action === "save-metric") await saveMetricRow(action.closest("tr"));
  if (action.dataset.action === "toggle-activity") await toggleActivity(action.dataset.id);
}

async function handleMainChange(event) {
  if (["dashboard-month", "metrics-month", "goals-month"].includes(event.target.id)) {
    state.month = event.target.value;
    state.week = "all";
    try { await reloadPeriod(); } catch (error) { toast(error.message, "error"); }
  }
  if (event.target.id === "dashboard-week") {
    state.week = event.target.value;
    renderDashboard();
  }
  if (event.target.classList.contains("metric-input")) {
    const row = event.target.closest("tr");
    row.querySelector(".save-row").classList.add("changed");
    if (event.target.dataset.field === "sales") row.querySelector("[data-revenue]").textContent = formatCurrency(Number(event.target.value) * state.settings.deal_value);
  }
}

function handleMainInput(event) {
  if (event.target.matches("[data-goal-field]")) {
    const values = Object.fromEntries($$("[data-goal-field]").map((input) => [input.dataset.goalField, Number(input.value) || 0]));
    $("#projection-flow").innerHTML = projectionRows(deriveGoals(values));
  }
  if (event.target.classList.contains("metric-input")) event.target.closest("tr").querySelector(".save-row").classList.add("changed");
}

function openLeadDialog(lead = null) {
  $("#lead-form").reset();
  $("#lead-id").value = lead?.id || "";
  $("#lead-dialog-title").textContent = lead ? "Editar lead" : "Novo lead";
  $("#delete-lead").classList.toggle("hidden", !lead);
  $("#lead-name").value = lead?.name || "";
  $("#lead-clinic").value = lead?.clinic_name || "";
  $("#lead-specialty").value = lead?.specialty || "";
  $("#lead-whatsapp").value = lead?.whatsapp || "";
  $("#lead-email").value = lead?.email || "";
  $("#lead-source").value = lead?.source || "Prospecção ativa";
  $("#lead-stage").value = lead?.stage || "new";
  $("#lead-value").value = lead?.deal_value ?? state.settings.deal_value;
  $("#lead-follow-up").value = lead?.next_follow_up || "";
  $("#lead-notes").value = lead?.notes || "";
  $("#lead-dialog").showModal();
}

async function saveLeadFromDialog(event) {
  event.preventDefault();
  const id = $("#lead-id").value;
  const payload = {
    ...(id ? { id } : {}), name: $("#lead-name").value.trim(), clinic_name: $("#lead-clinic").value.trim() || null,
    specialty: $("#lead-specialty").value.trim() || null, whatsapp: $("#lead-whatsapp").value.trim() || null,
    email: $("#lead-email").value.trim() || null, source: $("#lead-source").value, stage: $("#lead-stage").value,
    deal_value: Number($("#lead-value").value) || null, next_follow_up: $("#lead-follow-up").value || null, notes: $("#lead-notes").value.trim() || null,
  };
  try {
    await store.saveLead(payload);
    state.leads = await store.getLeads();
    $("#lead-dialog").close();
    renderDashboard(); renderLeads(); renderAgenda();
    toast(id ? "Lead atualizado." : "Lead adicionado ao pipeline.");
  } catch (error) { toast(error.message, "error"); }
}

async function deleteCurrentLead() {
  const id = $("#lead-id").value;
  if (!id || !confirm("Excluir este lead e suas atividades?")) return;
  try {
    await store.deleteLead(id);
    [state.leads, state.activities] = await Promise.all([store.getLeads(), store.getActivities()]);
    $("#lead-dialog").close();
    renderDashboard(); renderLeads(); renderAgenda();
    toast("Lead excluído.");
  } catch (error) { toast(error.message, "error"); }
}

function openActivityDialog() {
  $("#activity-form").reset();
  $("#activity-lead").innerHTML = `<option value="">Atividade geral</option>${state.leads.map((lead) => `<option value="${lead.id}">${escapeHtml(lead.name)}</option>`).join("")}`;
  $("#activity-due").value = `${todayIso()}T09:00`;
  $("#activity-google").checked = state.calendarEnabled;
  $("#activity-dialog").showModal();
}

function connectGoogleCalendar() {
  state.calendarEnabled = true;
  localStorage.setItem(CALENDAR_KEY, "1");
  renderAgenda();
  window.open("https://calendar.google.com/calendar/u/0/r", "_blank", "noopener");
  toast("Google Agenda ativado. Agora você pode enviar cada compromisso com um clique.");
}

async function saveActivityFromDialog(event) {
  event.preventDefault();
  const openInGoogle = $("#activity-google").checked;
  const googleWindow = openInGoogle ? window.open("about:blank", "_blank") : null;
  const payload = {
    title: $("#activity-title").value.trim(), lead_id: $("#activity-lead").value || null,
    kind: $("#activity-kind").value, due_at: $("#activity-due").value ? new Date($("#activity-due").value).toISOString() : null,
  };
  try {
    const created = await store.saveActivity(payload);
    if (openInGoogle) {
      state.calendarEnabled = true;
      localStorage.setItem(CALENDAR_KEY, "1");
      const lead = state.leads.find((item) => item.id === created.lead_id);
      const calendarUrl = googleCalendarUrl({ title: created.title, dueAt: created.due_at, details: `CRM Agência Líder Local\nLead: ${lead?.name || "Atividade geral"}\nTipo: ${activityKindLabel(created.kind)}` });
      if (googleWindow && calendarUrl) googleWindow.location.href = calendarUrl;
    }
    state.activities = await store.getActivities();
    $("#activity-dialog").close();
    renderDashboard(); renderAgenda();
    toast("Atividade criada.");
  } catch (error) {
    googleWindow?.close();
    toast(error.message, "error");
  }
}

async function toggleActivity(id) {
  const current = state.activities.find((activity) => activity.id === id);
  if (!current) return;
  try {
    await store.toggleActivity(id, !current.completed_at);
    state.activities = await store.getActivities();
    renderDashboard(); renderAgenda();
    toast(current.completed_at ? "Atividade reaberta." : "Atividade concluída.");
  } catch (error) { toast(error.message, "error"); }
}

async function saveMetricRow(row) {
  const metric = { metric_date: row.dataset.metricDate };
  $$(".metric-input", row).forEach((input) => { metric[input.dataset.field] = Math.max(0, Number(input.value) || 0); });
  const button = row.querySelector(".save-row");
  button.disabled = true;
  button.textContent = "…";
  try {
    await store.upsertMetric(metric);
    state.metrics = await store.getMetrics(state.month);
    renderDashboard(); renderMetrics();
    toast(`Registro de ${formatDate(metric.metric_date)} salvo.`);
  } catch (error) {
    button.disabled = false; button.textContent = "Salvar"; toast(error.message, "error");
  }
}

async function saveGoals(event) {
  event.preventDefault();
  const settings = Object.fromEntries($$("[data-goal-field]").map((input) => [input.dataset.goalField, Math.max(0, Number(input.value) || 0)]));
  try {
    state.settings = await store.saveSettings(state.month, settings);
    renderDashboard(); renderMetrics(); renderGoals();
    updateDashboardWidgets();
    toast("Metas do mês atualizadas. Todo o funil foi recalculado.");
  } catch (error) { toast(error.message, "error"); }
}

bootstrap();
