import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";
import { DEFAULT_SETTINGS, aggregateMetrics, deriveGoals, googleCalendarEvent, monthBounds, moveLeadToStage, normalizeGoogleEvents, normalizeWhatsAppTemplates, progress, reassignStage, renderWhatsAppMessage, weekOfMonth, whatsappWebUrl } from "./calculations.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const todayIso = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => todayIso().slice(0, 7);
const isLocalDemo = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";
const SESSION_KEY = "agencia-lider-local.crm.session.v1";
const GOOGLE_TOKEN_KEY = "agencia-lider-local.crm.google-token.v1";
const GOOGLE_TOKEN_EXPIRY_KEY = "agencia-lider-local.crm.google-token-expiry.v1";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const SIDEBAR_PIN_KEY = "agencia-lider-local.crm.sidebar-pinned.v1";
const VIEW_ROUTES = { dashboard: "/dashboard", leads: "/pipeline", metrics: "/registro-diario", agenda: "/agenda", maps: "/buscar-no-maps", goals: "/metas", settings: "/configuracoes" };
const ROUTE_VIEWS = Object.fromEntries(Object.entries(VIEW_ROUTES).map(([view, route]) => [route, view]));
function viewFromLocation() { return ROUTE_VIEWS[location.pathname.replace(/\/+$/, "") || "/"] || "dashboard"; }
const CITY_GUIDE_STATES = [
  ["AC", "Acre"], ["AL", "Alagoas"], ["AP", "Amapá"], ["AM", "Amazonas"], ["BA", "Bahia"],
  ["CE", "Ceará"], ["DF", "Distrito Federal"], ["ES", "Espírito Santo"], ["GO", "Goiás"], ["MA", "Maranhão"],
  ["MT", "Mato Grosso"], ["MS", "Mato Grosso do Sul"], ["MG", "Minas Gerais"], ["PA", "Pará"], ["PB", "Paraíba"],
  ["PR", "Paraná"], ["PE", "Pernambuco"], ["PI", "Piauí"], ["RJ", "Rio de Janeiro"], ["RN", "Rio Grande do Norte"],
  ["RS", "Rio Grande do Sul"], ["RO", "Rondônia"], ["RR", "Roraima"], ["SC", "Santa Catarina"], ["SP", "São Paulo"],
  ["SE", "Sergipe"], ["TO", "Tocantins"],
];
let cityGuideData = null;
let cityGuidePromise = null;
let draggedLeadId = null;
let suppressLeadClick = false;

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
  calendarConnected: false,
  googleIdentityLinked: false,
  googleAccessToken: sessionStorage.getItem(GOOGLE_TOKEN_KEY),
  googleEvents: [],
  googleEventsLoading: false,
  googleEventsError: "",
  editingActivityId: null,
  sidebarPinned: localStorage.getItem(SIDEBAR_PIN_KEY) !== "0",
  month: currentMonth(),
  agendaMonth: currentMonth(),
  week: "all",
  view: viewFromLocation(),
  loading: false,
  mapsKeyword: "",
  mapsLocality: "",
  mapsResults: [],
  mapsLoading: false,
  mapsError: "",
  mapsStatusMessage: "",
  mapsSearched: false,
  mapsPendingJobId: null,
  mapsSearchBatch: 0,
  mapsSearchCenter: "",
  mapsHasMore: false,
  mapsProspectFilter: "all",
  mapsReferences: [],
  mapsPendingLeadPlace: null,
  mapsGuideState: "",
  mapsGuideCity: "",
  mapsSubtab: "new",
  mapsSavedSearches: [],
  mapsSavedSearchesLoading: false,
  mapsActiveSavedSearchId: null,
  mapsSelectedPlaceIds: [],
  mapsViewMode: "cards",
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
  clearGoogleConnection();
}

function clearGoogleConnection() {
  state.calendarConnected = false;
  state.googleAccessToken = null;
  state.googleEvents = [];
  state.googleEventsError = "";
  state.googleEventsLoading = false;
  sessionStorage.removeItem(GOOGLE_TOKEN_KEY);
  sessionStorage.removeItem(GOOGLE_TOKEN_EXPIRY_KEY);
}

function consumeOAuthCallback() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (!params.has("provider_token") && !params.has("access_token") && !params.has("error")) return;

  if (params.get("error")) {
    sessionStorage.setItem("agencia-lider-local.crm.oauth-error", params.get("error_description") || "A autorização do Google foi cancelada.");
  } else {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null") || {};
    if (params.get("access_token")) {
      saveSession({
        ...saved,
        access_token: params.get("access_token"),
        refresh_token: params.get("refresh_token") || saved.refresh_token,
        expires_in: Number(params.get("expires_in")) || saved.expires_in,
        token_type: params.get("token_type") || saved.token_type,
      });
    }
    const providerToken = params.get("provider_token");
    if (providerToken) {
      const expiresIn = Math.max(60, Number(params.get("expires_in")) || 3600);
      state.googleAccessToken = providerToken;
      sessionStorage.setItem(GOOGLE_TOKEN_KEY, providerToken);
      sessionStorage.setItem(GOOGLE_TOKEN_EXPIRY_KEY, String(Date.now() + expiresIn * 1000));
      sessionStorage.setItem("agencia-lider-local.crm.oauth-success", "1");
    }
  }
  history.replaceState({}, document.title, `${location.pathname}${location.search}`);
}

function hasValidGoogleToken() {
  const expiry = Number(sessionStorage.getItem(GOOGLE_TOKEN_EXPIRY_KEY)) || 0;
  return Boolean(state.googleAccessToken && expiry > Date.now() + 30_000);
}

function hasGoogleIdentity() {
  return state.googleIdentityLinked || Boolean(state.user?.identities?.some((identity) => identity.provider === "google"));
}

async function loadGoogleIdentity() {
  try {
    const identities = await authRequest("/user/identities");
    state.googleIdentityLinked = Array.isArray(identities) && identities.some((identity) => identity.provider === "google");
  } catch (error) {
    state.googleIdentityLinked = Boolean(state.user?.identities?.some((identity) => identity.provider === "google"));
  }
  syncGoogleConnection();
}

function syncGoogleConnection() {
  state.calendarConnected = hasGoogleIdentity() && hasValidGoogleToken();
}

async function loadGoogleEvents({ notify = false } = {}) {
  if (!state.calendarConnected || !hasValidGoogleToken()) return;
  state.googleEventsLoading = true;
  state.googleEventsError = "";
  renderAgenda();
  try {
    const timeMin = new Date();
    timeMin.setHours(0, 0, 0, 0);
    const timeMax = new Date(timeMin);
    timeMax.setDate(timeMax.getDate() + 90);
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "100",
      timeZone: "America/Sao_Paulo",
    });
    const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${state.googleAccessToken}` },
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401) {
      clearGoogleConnection();
      throw new Error("A autorização do Google expirou. Conecte novamente para atualizar os eventos.");
    }
    if (!response.ok) throw new Error(payload?.error?.message || "Não foi possível ler os eventos do Google Agenda.");
    state.googleEvents = normalizeGoogleEvents(payload.items || []);
    if (notify) toast(`${state.googleEvents.length} evento(s) atualizado(s) do Google Agenda.`);
  } catch (error) {
    state.googleEventsError = error.message;
    if (notify) toast(error.message, "error");
  } finally {
    state.googleEventsLoading = false;
    renderAgenda();
  }
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
      if (!rows?.[0]) throw new Error("O Supabase não confirmou a atualização deste card. Recarregue a página e tente novamente.");
      return rows[0];
    }
    const rows = await rest("leads", { method: "POST", body: { owner_id: state.user.id, ...lead } });
    if (!rows?.[0]) throw new Error("O Supabase não confirmou a criação deste card. Tente novamente.");
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
  async updateActivity(id, activity) {
    if (isLocalDemo) {
      const item = mock.activities.find((entry) => entry.id === id);
      if (!item) throw new Error("Atividade não encontrada.");
      Object.assign(item, activity);
      return item;
    }
    const rows = await rest("activities", { method: "PATCH", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, body: activity });
    if (!rows?.[0]) throw new Error("O Supabase não confirmou a atualização da atividade.");
    return rows[0];
  },
  async saveActivityGoogleEvent(id, googleEvent) {
    const payload = { google_event_id: googleEvent.id, google_event_url: googleEvent.htmlLink || null };
    if (isLocalDemo) {
      const item = mock.activities.find((activity) => activity.id === id);
      Object.assign(item, payload);
      return item;
    }
    const rows = await rest("activities", { method: "PATCH", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, body: payload });
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
  async deleteActivity(id) {
    if (isLocalDemo) {
      mock.activities = mock.activities.filter((activity) => activity.id !== id);
      return;
    }
    await rest("activities", { method: "DELETE", query: `id=eq.${id}&owner_id=eq.${state.user.id}`, prefer: "return=minimal" });
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
  consumeOAuthCallback();
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (saved?.access_token) {
      state.session = saved;
      try {
        state.user = await authRequest("/user");
      } catch (error) {
        // O access_token salvo pode ter expirado (validade padrão de 1h).
        // Antes de derrubar a sessão, tenta renovar automaticamente com o refresh_token.
        if (!saved.refresh_token) throw error;
        await refreshSession();
        state.user = await authRequest("/user");
      }
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
  $("#sidebar-pin-button").addEventListener("click", toggleSidebarPin);
  window.addEventListener("popstate", () => navigate(viewFromLocation(), { history: false }));
  $$(".modal-close").forEach((button) => button.addEventListener("click", () => $("#lead-dialog").close()));
  $$(".activity-close").forEach((button) => button.addEventListener("click", () => $("#activity-dialog").close()));
  $$(".stage-close").forEach((button) => button.addEventListener("click", () => $("#stage-dialog").close()));
  $("#lead-form").addEventListener("submit", saveLeadFromDialog);
  $("#lead-activity-button").addEventListener("click", () => {
    const leadId = $("#lead-id").value;
    $("#lead-dialog").close();
    openActivityDialog(null, leadId);
  });
  $("#delete-lead").addEventListener("click", deleteCurrentLead);
  $("#activity-form").addEventListener("submit", saveActivityFromDialog);
  $("#activity-kind").addEventListener("change", updateActivityKindControls);
  $("#stage-add-form").addEventListener("submit", addPipelineStage);
  $("#stage-dialog").addEventListener("click", handleStageDialogClick);
  $("#stage-list").addEventListener("dragstart", handleStageReorderStart);
  $("#stage-list").addEventListener("dragover", handleStageReorderOver);
  $("#stage-list").addEventListener("drop", handleStageReorderDrop);
  $("#stage-list").addEventListener("dragend", handleStageReorderEnd);
  $("#day-dialog").addEventListener("click", handleDayDialogClick);
  $("#day-dialog").addEventListener("close", () => { openDayIso = null; });
  $("#lead-dialog").addEventListener("click", handleLeadDialogClick);
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
  document.body.classList.remove("booting");
  $("#auth-screen").classList.remove("hidden");
  $("#app-shell").classList.add("hidden");
}

async function enterApp() {
  document.body.classList.remove("booting");
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  const name = state.user.user_metadata?.full_name || state.user.email?.split("@")[0] || "Usuário";
  $("#user-name").textContent = name;
  $("#user-email").textContent = state.user.email || "Modo demonstração";
  $("#user-avatar").textContent = initials(name);
  syncGoogleConnection();
  if (!isLocalDemo) await loadGoogleIdentity();
  state.loading = true;
  renderAll();
  try {
    await loadData();
    if (!isLocalDemo) await loadSavedSearches({ render: false });
  } catch (error) {
    toast(error.message, "error");
  } finally {
    state.loading = false;
    renderAll();
    populateStageOptions();
    const oauthError = sessionStorage.getItem("agencia-lider-local.crm.oauth-error");
    const oauthSuccess = sessionStorage.getItem("agencia-lider-local.crm.oauth-success");
    sessionStorage.removeItem("agencia-lider-local.crm.oauth-error");
    sessionStorage.removeItem("agencia-lider-local.crm.oauth-success");
    if (oauthError) toast(oauthError, "error");
    if (oauthSuccess && state.calendarConnected) toast("Google Agenda conectado de verdade.");
    if (oauthSuccess && !state.calendarConnected && hasGoogleIdentity()) toast("Conta Google vinculada. Autorize novamente o acesso ao calendário para ativar os eventos.", "error");
    if (state.calendarConnected) await loadGoogleEvents();
  }
}

async function loadData() {
  const [settings, metrics, leads, activities, stages] = await Promise.all([
    store.getSettings(state.month), store.getMetrics(state.month), store.getLeads(), store.getActivities(), store.getStages(),
  ]);
  state.settings = { ...DEFAULT_SETTINGS, ...settings, whatsapp_templates: normalizeWhatsAppTemplates(settings.whatsapp_templates) };
  state.metrics = metrics;
  state.leads = leads;
  state.activities = activities;
  state.stages = stages.map((stage) => ({ ...stage, value: stage.stage_key, label: stage.name }));
}

async function reloadPeriod() {
  const [settings, metrics] = await Promise.all([store.getSettings(state.month), store.getMetrics(state.month)]);
  state.settings = { ...DEFAULT_SETTINGS, ...settings, whatsapp_templates: normalizeWhatsAppTemplates(settings.whatsapp_templates) };
  state.metrics = metrics;
    renderDashboard();
  renderMetrics();
  renderGoals();
  renderSettings();
}
async function logout() {
  try { if (!isLocalDemo) await authRequest("/logout", { method: "POST" }); } catch { /* local session is still cleared */ }
  clearSession();
  location.href = location.pathname;
}

function syncSidebarState() {
  const shell = $("#app-shell");
  const pin = $("#sidebar-pin-button");
  if (!shell || !pin) return;
  shell.classList.toggle("sidebar-pinned", state.sidebarPinned);
  shell.classList.toggle("sidebar-auto-hide", !state.sidebarPinned);
  pin.classList.toggle("active", state.sidebarPinned);
  pin.setAttribute("aria-pressed", state.sidebarPinned ? "true" : "false");
  pin.title = state.sidebarPinned ? "Desafixar painel lateral" : "Fixar painel lateral";
}

function toggleSidebarPin() {
  state.sidebarPinned = !state.sidebarPinned;
  localStorage.setItem(SIDEBAR_PIN_KEY, state.sidebarPinned ? "1" : "0");
  syncSidebarState();
}

function navigate(view, options = {}) {
  if (!VIEW_ROUTES[view]) view = "dashboard";
  state.view = view;
  if (options.history !== false && location.pathname !== VIEW_ROUTES[view]) history.pushState({ view }, "", VIEW_ROUTES[view]);
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
  renderMapsSearch();
  renderGoals();
  renderSettings();
  navigate(state.view, { history: false });
  syncSidebarState();
}

function pageHead(eyebrow, title, subtitle, actions = "", inlineStatus = "") {
  return `<header class="page-head ${inlineStatus ? "dashboard-head" : ""}"><div class="page-title"><span class="eyebrow">${eyebrow}</span><div class="page-title-row"><h1>${title}</h1>${inlineStatus}</div>${subtitle ? `<p>${subtitle}</p>` : ""}</div><div class="head-actions">${actions}</div></header>`;
}

function monthInput(id, value = state.month) {
  return `<input id="${id}" class="compact-input" type="month" value="${value}" aria-label="Escolher mês" />`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function isoDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function metricRowsForFilter() {
  if (state.week === "all") return state.metrics;
  return state.metrics.filter((row) => weekOfMonth(row.metric_date) === Number(state.week));
}

function renderDashboard() {
  const rows = metricRowsForFilter();
  const totals = aggregateMetrics(rows, state.settings.deal_value);
  const goals = deriveGoals(state.settings);
  const salesProgress = progress(totals.sales, goals.sales);
  const allStages = [
    ["Leads", totals.leads, goals.leads], ["Mensagens", totals.messages, goals.messages],
    ["Reuniões agendadas", totals.meetingsScheduled, goals.meetingsScheduled], ["Reuniões realizadas", totals.meetingsCompleted, goals.meetingsCompleted],
    ["Negociação", totals.negotiations, goals.negotiations], ["Vendas", totals.sales, goals.sales],
  ];
  const maxGoal = Math.max(1, ...allStages.map((item) => item[2]));
  const recentLeads = state.leads.slice(0, 5);
  $("#view-dashboard").innerHTML = `
    <header class="page-head dashboard-controls"><span class="eyebrow">PAINEL DE ÓRBITA</span><div class="head-actions">
      <div class="filters">${monthInput("dashboard-month")}<select id="dashboard-week" class="compact-select"><option value="all">Todas as semanas</option>${[1,2,3,4,5,6].map((w) => `<option value="${w}" ${state.week === String(w) ? "selected" : ""}>Semana ${w}</option>`).join("")}</select></div>
      <button class="button primary" data-action="open-lead">+ Novo lead</button>
    </div></header>
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
  if (!rows.length) return emptyState("◷", "Agenda em dia", "Crie uma atividade para não perder o próximo passo.", `<button class="button primary small" data-action="open-activity">Criar atividade</button>`);
  return `<div class="list">${rows.map((activity) => {
    const lead = state.leads.find((item) => item.id === activity.lead_id);
    return `<div class="list-row"><button class="activity-check" data-action="toggle-activity" data-id="${activity.id}" aria-label="Concluir atividade"></button><span class="list-main"><b>${escapeHtml(activity.title)}</b><span>${escapeHtml(lead?.name || "Atividade geral")}</span></span><span class="activity-time ${isOverdue(activity) ? "overdue" : ""}">${activity.due_at ? formatDate(activity.due_at) : "Sem prazo"}</span></div>`;
  }).join("")}</div>`;
}

function renderLeads() {
  $("#view-leads").innerHTML = `
    ${pageHead("PIPELINE COMERCIAL", "", "", `<span class="date-chip">${state.leads.length} leads</span><button class="button ghost" data-action="manage-stages">⚙ Etapas</button><button class="button primary" data-action="open-lead">+ Novo lead</button>`)}
    <div class="kanban">${state.stages.map((stage) => {
      const leads = state.leads.filter((lead) => lead.stage === stage.value);
      return `<section class="kanban-column" data-drop-stage="${stage.value}"><div class="kanban-head"><span><i style="--column-color:${stage.color}"></i>${escapeHtml(stage.label)}</span><b class="kanban-count">${leads.length}</b></div><div class="kanban-cards">${leads.length ? leads.map(leadCard).join("") : `<div class="empty-column">Solte um lead nesta etapa</div>`}</div></section>`;
    }).join("")}</div>`;
}

async function toggleLeadContact(leadId) {
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) return;
  const contactedAt = lead.contacted_at ? null : new Date().toISOString();
  const currentIndex = state.stages.findIndex((stage) => stage.value === lead.stage);
  const nextStage = contactedAt && currentIndex >= 0 ? state.stages[currentIndex + 1] : null;
  const restoredStage = !contactedAt && lead.contacted_previous_stage
    ? state.stages.find((stage) => stage.value === lead.contacted_previous_stage)
    : null;
  const nextPayload = contactedAt
    ? { ...(nextStage ? { stage: nextStage.value, contacted_previous_stage: lead.stage } : {}) }
    : { ...(restoredStage ? { stage: restoredStage.value } : {}), contacted_previous_stage: null };
  try {
    const saved = await store.saveLead({ id: lead.id, contacted_at: contactedAt, ...nextPayload });
    Object.assign(lead, saved || { contacted_at: contactedAt, ...nextPayload });
    renderDashboard();
    renderLeads();
    const restoredMessage = restoredStage ? ` e voltou para ${restoredStage.label}` : "";
    toast(contactedAt ? `${lead.name} marcado como “Contatado”${nextStage ? ` e movido para ${nextStage.label}.` : "."}` : `${lead.name} removido de “Contatado”${restoredMessage}.`);
  } catch (error) {
    toast(error.message || "Não foi possível atualizar o contato.", "error");
  }
}

async function deleteLeadFromCard(leadId) {
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead || !confirm(`Excluir o lead “${lead.name}” e suas atividades?`)) return;
  try {
    await store.deleteLead(leadId);
    [state.leads, state.activities] = await Promise.all([store.getLeads(), store.getActivities()]);
    renderDashboard(); renderLeads(); renderAgenda();
    toast("Lead excluído.");
  } catch (error) {
    toast(error.message || "Não foi possível excluir o lead.", "error");
  }
}

function leadCard(lead) {
  const overdue = lead.next_follow_up && lead.next_follow_up < todayIso();
  const leadActivities = state.activities.filter((activity) => activity.lead_id === lead.id).sort((a, b) => String(a.completed_at || "").localeCompare(String(b.completed_at || "")) || String(a.due_at || "9999").localeCompare(String(b.due_at || "9999")));
  const previewActivities = leadActivities.filter((activity) => !activity.completed_at).slice(0, 2);
  const activityMarkup = previewActivities.length ? `<div class="lead-card-activities">${previewActivities.map((activity) => `<span title="${escapeHtml(activity.title)}${activity.due_at ? ` · ${formatDate(activity.due_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}"><i></i>${escapeHtml(activity.title)}</span>`).join("")}</div>` : "";
  const activityAction = `<button type="button" draggable="false" class="lead-activity-quick icon-only" data-action="open-lead-activity" data-id="${lead.id}" aria-label="Nova atividade para ${escapeHtml(lead.name)}" title="Nova atividade"><span aria-hidden="true">＋</span></button>`;
  const followUpIndicator = lead.next_follow_up ? `<span class="lead-follow-up-dot ${overdue ? "overdue" : ""}" title="Follow-up em ${formatDate(lead.next_follow_up)}" aria-label="Follow-up em ${formatDate(lead.next_follow_up)}"></span>` : "";
  const whatsappAction = lead.whatsapp ? `<button type="button" draggable="false" class="whatsapp-button" data-action="open-whatsapp" data-id="${lead.id}" aria-label="Abrir WhatsApp de ${escapeHtml(lead.name)}" title="WhatsApp de ${escapeHtml(lead.name)}"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M12 3.2a8.8 8.8 0 0 0-7.58 13.27L3.2 20.8l4.48-1.18A8.8 8.8 0 1 0 12 3.2Zm0 1.7a7.1 7.1 0 0 1 5.03 12.13 7.1 7.1 0 0 1-8.36 1.27l-.48-.25-2.65.7.71-2.58-.28-.49A7.1 7.1 0 0 1 12 4.9Zm-2.25 2.28c-.2 0-.52.08-.79.38-.27.3-1.03 1.01-1.03 2.47s1.05 2.86 1.2 3.05c.15.2 2.03 3.25 5.02 4.42 2.48.97 2.99.78 3.53.73.54-.05 1.75-.71 2-1.4.25-.69.25-1.28.17-1.4-.07-.12-.27-.2-.57-.35-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.5h-.52Z"/></svg><span>WhatsApp</span></button>` : "";
  const contactTag = lead.contacted_at ? `<span class="contacted-tag">Em contato</span>` : "";
  const contactCheck = `<button type="button" draggable="false" class="lead-contact-toggle ${lead.contacted_at ? "checked" : ""}" data-action="toggle-lead-contact" data-id="${lead.id}" aria-pressed="${lead.contacted_at ? "true" : "false"}" aria-label="${lead.contacted_at ? "Desmarcar contatado" : "Marcar como contatado"}">${lead.contacted_at ? "✓" : ""}</button>`;
  const deleteAction = `<button type="button" draggable="false" class="lead-card-delete" data-action="delete-lead-card" data-id="${lead.id}" aria-label="Excluir ${escapeHtml(lead.name)}" title="Excluir lead"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-.8 11.2a2 2 0 0 1-2 1.8H8.8a2 2 0 0 1-2-1.8L6 9Zm3 2v7h2v-7H9Zm4 0v7h2v-7h-2Z"/></svg></button>`;
  return `<article class="lead-card ${lead.contacted_at ? "lead-contacted" : ""}" draggable="true" data-action="edit-lead" data-id="${lead.id}" title="Arraste para mudar de etapa ou clique para editar"><div class="lead-card-top"><div><h3>${escapeHtml(lead.name)}</h3><div class="lead-card-subtitle">${contactTag}</div></div><div class="lead-card-header-actions"><span class="lead-card-value">${formatCurrency(lead.deal_value || state.settings.deal_value)}</span>${deleteAction}</div></div><div class="lead-meta">${followUpIndicator}</div>${activityMarkup}<div class="lead-card-footer">${whatsappAction}${activityAction}<span class="contact-check-label">${contactCheck} ${lead.contacted_at ? "Em contato" : "Contatado"}</span></div></article>`;
}

function whatsappTemplateUsageToday() {
  const usage = state.settings.whatsapp_template_usage && typeof state.settings.whatsapp_template_usage === "object" ? state.settings.whatsapp_template_usage : {};
  const today = todayIso();
  return usage[today] && typeof usage[today] === "object" ? usage[today] : {};
}
function whatsappTemplateLimit(index) {
  const limits = state.settings.whatsapp_template_limits && typeof state.settings.whatsapp_template_limits === "object" ? state.settings.whatsapp_template_limits : {};
  return Math.max(0, Number(limits[String(index)]) || 0);
}
function chooseWhatsAppTemplateIndex(templates) {
  const usageToday = whatsappTemplateUsageToday();
  const eligible = templates.map((_, index) => index).filter((index) => {
    const limit = whatsappTemplateLimit(index);
    return !limit || Number(usageToday[String(index)] || 0) < limit;
  });
  if (state.settings.whatsapp_randomize_templates && eligible.length) return eligible[Math.floor(Math.random() * eligible.length)];
  const configuredIndex = Math.min(Math.max(0, Number(state.settings.whatsapp_default_template) || 0), templates.length - 1);
  return configuredIndex;
}
async function recordWhatsAppTemplateUsage(index) {
  const today = todayIso();
  const usage = state.settings.whatsapp_template_usage && typeof state.settings.whatsapp_template_usage === "object" ? structuredClone(state.settings.whatsapp_template_usage) : {};
  const day = usage[today] && typeof usage[today] === "object" ? { ...usage[today] } : {};
  day[String(index)] = Number(day[String(index)] || 0) + 1;
  state.settings = { ...state.settings, whatsapp_template_usage: { [today]: day } };
  try {
    const saved = await store.saveSettings(state.month, { whatsapp_template_usage: state.settings.whatsapp_template_usage });
    state.settings = { ...state.settings, ...saved, whatsapp_template_usage: state.settings.whatsapp_template_usage };
  } catch (error) {
    toast("WhatsApp aberto, mas não foi possível salvar o contador do modelo.", "error");
  }
}
async function openLeadWhatsApp(leadId) {
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) return toast("Lead não encontrado.", "error");
  const templates = normalizeWhatsAppTemplates(state.settings.whatsapp_templates);
  const templateIndex = chooseWhatsAppTemplateIndex(templates);
  const template = templates[templateIndex] || templates[0];
  const templateLimit = whatsappTemplateLimit(templateIndex);
  const templateUsedToday = Number(whatsappTemplateUsageToday()[String(templateIndex)] || 0);
  if (templateLimit && templateUsedToday >= templateLimit) return toast(`O modelo “${template.label}” atingiu o limite diário de ${templateLimit}. Escolha outro modelo nas Configurações ou desative o sorteio.`, "error");
  const sender = String(state.user?.user_metadata?.full_name || "Damião").trim().split(/\s+/)[0] || "Damião";
  const message = renderWhatsAppMessage(template.body, lead, sender);
  const url = whatsappWebUrl({ phone: lead.whatsapp, message });
  if (!url) return toast("Cadastre um WhatsApp válido para este lead.", "error");
  const dailyLimit = Math.max(0, Number(state.settings.whatsapp_daily_limit) || 0);
  const contactsToday = state.leads.filter((item) => item.contacted_at?.slice(0, 10) === todayIso()).length;
  if (dailyLimit && contactsToday >= dailyLimit && !window.confirm(`Você já registrou ${contactsToday} contatos hoje, atingindo o limite de referência configurado. Deseja continuar manualmente?`)) return;
  window.open(url, "_blank", "noopener,noreferrer");
  await recordWhatsAppTemplateUsage(templateIndex);
  if (!lead.contacted_at) await toggleLeadContact(leadId);
}

function openStageDialog() {
  renderStageManager();
  $("#new-stage-name").value = "";
  $("#stage-dialog").showModal();
}

function renderStageManager() {
  $("#stage-list").innerHTML = state.stages.map((stage, index) => {
    const leadCount = state.leads.filter((lead) => lead.stage === stage.value).length;
    return `<div class="stage-editor" draggable="true" data-stage-id="${stage.id}">
      <button class="stage-drag-handle" type="button" draggable="false" aria-label="Reordenar etapa" title="Arraste para reordenar">⋮⋮</button><span class="stage-order">${index + 1}</span>
      <input class="stage-color" data-stage-color type="color" value="${stage.color || "#2bdcaf"}" aria-label="Cor da etapa ${escapeHtml(stage.label)}" />
      <label class="field"><span>Nome da etapa</span><input data-stage-name maxlength="48" value="${escapeHtml(stage.label)}" /></label>
      <span class="stage-lead-count">${leadCount} ${leadCount === 1 ? "lead" : "leads"}</span>
      <button class="button small" data-stage-action="save" type="button">Salvar</button>
      <button class="icon-button danger-icon" data-stage-action="delete" type="button" aria-label="Excluir ${escapeHtml(stage.label)}">×</button>
    </div>`;
  }).join("");
}

let draggedStageId = null;

function handleStageReorderStart(event) {
  const row = event.target.closest(".stage-editor");
  if (!row || event.target.closest("input, button")) return;
  draggedStageId = row.dataset.stageId;
  row.classList.add("dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggedStageId);
}

function handleStageReorderOver(event) {
  const target = event.target.closest(".stage-editor");
  if (!target || !draggedStageId || target.dataset.stageId === draggedStageId) return;
  event.preventDefault();
  $$(".stage-editor.stage-drop-target").forEach((item) => item.classList.remove("stage-drop-target"));
  target.classList.add("stage-drop-target");
}

async function handleStageReorderDrop(event) {
  const target = event.target.closest(".stage-editor");
  if (!target || !draggedStageId) return;
  event.preventDefault();
  const sourceIndex = state.stages.findIndex((stage) => stage.id === draggedStageId);
  const targetIndex = state.stages.findIndex((stage) => stage.id === target.dataset.stageId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return handleStageReorderEnd();
  const reordered = [...state.stages];
  const [moved] = reordered.splice(sourceIndex, 1);
  reordered.splice(targetIndex, 0, moved);
  state.stages = reordered.map((stage, position) => ({ ...stage, position }));
  renderLeads();
  renderStageManager();
  try {
    await Promise.all(state.stages.map((stage) => store.saveStage({ id: stage.id, position: stage.position })));
    populateStageOptions();
    toast("Ordem do funil atualizada.");
  } catch (error) {
    toast(error.message || "Não foi possível salvar a ordem do funil.", "error");
  }
  handleStageReorderEnd();
}

function handleStageReorderEnd() {
  draggedStageId = null;
  $$(".stage-editor.dragging, .stage-editor.stage-drop-target").forEach((item) => item.classList.remove("dragging", "stage-drop-target"));
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
  if (event.target.closest('[data-action="open-whatsapp"]')) {
    event.preventDefault();
    return;
  }
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
  const todayIndex = dates.findIndex((row) => row.metric_date === todayIso());
  if (todayIndex > 0) dates.unshift(dates.splice(todayIndex, 1)[0]);
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
  const weekday = new Date(`${row.metric_date}T12:00:00`).getDay();
  const isWeekend = weekday === 0 || weekday === 6;
  const isToday = row.metric_date === todayIso();
  return `<tr data-metric-date="${row.metric_date}" class="${isWeekend ? "weekend-row" : ""} ${isToday ? "today-row" : ""}"><td class="metric-date">${formatDate(row.metric_date, { day: "2-digit", month: "2-digit", weekday: "short" })}</td><td><span class="week-tag">S${weekOfMonth(row.metric_date)}</span></td>${fields.map((field) => `<td><input class="metric-input" data-field="${field}" type="number" min="0" value="${Number(row[field]) || 0}" aria-label="${field}" /></td>`).join("")}<td data-revenue>${formatCurrency((Number(row.sales) || 0) * state.settings.deal_value)}</td><td><button class="button small save-row" data-action="save-metric">Salvar</button></td></tr>`;
}

const WEEKDAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
let openDayIso = null;

function activitiesByDay() {
  const map = new Map();
  state.activities.forEach((activity) => {
    if (!activity.due_at) return;
    const key = activity.due_at.slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(activity);
  });
  return map;
}

function googleEventsByDay() {
  const map = new Map();
  state.googleEvents.forEach((event) => {
    const key = event.start?.slice(0, 10);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(event);
  });
  return map;
}

function calendarCells(monthStr) {
  const [year, month] = monthStr.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const cells = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNumber = i - firstWeekday + 1;
    const date = new Date(year, month - 1, dayNumber);
    cells.push({ iso: isoDate(date.getFullYear(), date.getMonth() + 1, date.getDate()), day: date.getDate(), inMonth: dayNumber >= 1 && dayNumber <= daysInMonth });
  }
  return cells;
}

function renderAgenda() {
  const open = state.activities.filter((activity) => !activity.completed_at);
  const overdue = open.filter(isOverdue).length;
  const today = open.filter((activity) => activity.due_at?.slice(0, 10) === todayIso()).length;
  const byDay = activitiesByDay();
  const googleByDay = googleEventsByDay();
  const googleActions = state.calendarConnected
    ? `<button class="button google-button connected" data-action="refresh-google-calendar" ${state.googleEventsLoading ? "disabled" : ""}>${state.googleEventsLoading ? "Atualizando…" : "↻ Google conectado"}</button>`
    : hasGoogleIdentity()
      ? `<button class="button google-button connected" data-action="connect-google-calendar" title="Conta Google vinculada; clique para autorizar o acesso ao calendário">✓ Google vinculado · autorizar Agenda</button>`
      : `<button class="button google-button" data-action="connect-google-calendar">G Conectar Google Agenda</button>`;
  const cells = calendarCells(state.agendaMonth);
  $("#view-agenda").innerHTML = `
    ${pageHead("AGENDA COMERCIAL", "Calendário de atividades", "Clique em um dia para ver os agendamentos.", `${monthInput("agenda-month", state.agendaMonth)}${googleActions}<button class="button primary" data-action="open-activity">+ Criar atividade</button>`)}
    <div class="agenda-layout"><section class="panel">
      <div class="calendar-weekdays">${WEEKDAY_LABELS.map((label) => `<span>${label}</span>`).join("")}</div>
      <div class="calendar-grid">${cells.map((cell) => calendarCell(cell, byDay.get(cell.iso) || [], googleByDay.get(cell.iso) || [])).join("")}</div>
    </section><aside class="panel"><div class="panel-head"><div><h2>Resumo da agenda</h2><span>Prioridades atuais</span></div></div><div class="agenda-summary"><div class="summary-tile"><span>Para hoje</span><b>${today}</b></div><div class="summary-tile"><span>Em atraso</span><b style="color:${overdue ? "var(--red)" : "var(--green)"}">${overdue}</b></div><div class="summary-tile"><span>Eventos Google</span><b>${state.googleEvents.length}</b></div><div class="summary-tile"><span>Total no mês</span><b>${state.activities.filter((activity) => activity.due_at?.slice(0, 7) === state.agendaMonth).length}</b></div></div></aside></div>`;
  if (openDayIso) renderDayDialog(openDayIso);
}

function calendarCell(cell, activities, googleEvents) {
  const pending = activities.filter((activity) => !activity.completed_at);
  const hasOverdue = pending.some(isOverdue);
  const isToday = cell.iso === todayIso();
  const badges = [
    pending.length ? `<span class="day-badge ${hasOverdue ? "overdue" : ""}">${pending.length}</span>` : "",
    googleEvents.length ? `<span class="day-badge google">G·${googleEvents.length}</span>` : "",
  ].filter(Boolean).join("");
  return `<button type="button" class="calendar-day ${cell.inMonth ? "" : "out-month"} ${isToday ? "today" : ""}" data-action="open-day" data-date="${cell.iso}"><span class="calendar-day-number">${cell.day}</span><span class="calendar-day-badges">${badges}</span></button>`;
}

function renderDayDialog(iso) {
  openDayIso = iso;
  const dayActivities = (activitiesByDay().get(iso) || []).sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)));
  const dayGoogleEvents = (googleEventsByDay().get(iso) || []);
  const label = formatDate(iso, { weekday: "long", day: "2-digit", month: "long" });
  const empty = !dayActivities.length && !dayGoogleEvents.length;
  $("#day-dialog-title").textContent = label.charAt(0).toUpperCase() + label.slice(1);
  $("#day-dialog-body").innerHTML = empty
    ? emptyState("◷", "Nenhum agendamento", "Não há atividades nem eventos do Google Agenda neste dia.", "")
    : `${dayActivities.map(activityRow).join("")}${dayGoogleEvents.map(googleEventRow).join("")}`;
  $("#day-dialog-add").dataset.date = iso;
}

function openDayDialog(iso) {
  renderDayDialog(iso);
  $("#day-dialog").showModal();
}

async function handleDayDialogClick(event) {
  if (event.target.closest(".day-close")) { $("#day-dialog").close(); return; }
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "add-activity-day") { $("#day-dialog").close(); openActivityDialog(action.dataset.date); }
  if (action.dataset.action === "toggle-activity") await toggleActivity(action.dataset.id);
  if (action.dataset.action === "sync-google-activity") await syncActivityToGoogle(action.dataset.id);
}

function isOverdue(activity) {
  return !activity.completed_at && activity.due_at && new Date(activity.due_at) < new Date();
}

function activityRow(activity) {
  const lead = state.leads.find((item) => item.id === activity.lead_id);
  const calendarAction = state.calendarConnected && activity.due_at
    ? activity.google_event_id
      ? `<a class="calendar-link" href="${escapeHtml(activity.google_event_url || "https://calendar.google.com/calendar/u/0/r")}" target="_blank" rel="noopener">Abrir no Google Agenda ↗</a>`
      : `<button class="calendar-link calendar-action" data-action="sync-google-activity" data-id="${activity.id}">Adicionar ao Google Agenda</button>`
    : "";
  return `<div class="activity-row ${activity.completed_at ? "done" : ""}"><button class="activity-check ${activity.completed_at ? "done" : ""}" data-action="toggle-activity" data-id="${activity.id}" aria-label="${activity.completed_at ? "Reabrir" : "Concluir"} atividade"></button><div class="activity-main"><b>${escapeHtml(activity.title)}</b><span>${escapeHtml(lead?.name || "Atividade geral")} · ${activityKindLabel(activity.kind)}</span>${calendarAction}</div><span class="activity-time ${isOverdue(activity) ? "overdue" : ""}">${activity.due_at ? formatDate(activity.due_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sem prazo"}</span><button type="button" class="activity-delete" data-action="delete-activity" data-id="${activity.id}" aria-label="Excluir atividade" title="Excluir atividade">×</button></div>`;
}

function mapsSavedTabsMarkup() {
  return `<div class="maps-subtabs" role="tablist" aria-label="Pesquisas no Maps">
    <button class="maps-subtab ${state.mapsSubtab === "new" ? "active" : ""}" type="button" data-action="maps-subtab-new">Nova pesquisa</button>
    <button class="maps-subtab ${state.mapsSubtab === "saved" ? "active" : ""}" type="button" data-action="maps-subtab-saved">Pesquisas salvas <span>${state.mapsSavedSearches.length}</span></button>
  </div>`;
}

function savedSearchesMarkup() {
  if (state.mapsSavedSearchesLoading) return `<div class="loading">Carregando pesquisas salvas…</div>`;
  if (!state.mapsSavedSearches.length) return emptyState("▣", "Nenhuma pesquisa salva", "Faça uma busca no Maps e salve os resultados para reutilizá-los sem consumir a API.", "");
  return `<div class="saved-searches-list">${state.mapsSavedSearches.map((search) => `<article class="saved-search-card">
    <div class="saved-search-main"><div class="saved-search-title-row"><h3>${escapeHtml(search.name)}</h3><span class="saved-search-count">${Number(search.result_count || 0)} empresas</span></div>
      <p class="saved-search-query"><b>${escapeHtml(search.keyword)}</b> · ${escapeHtml(search.locality)}</p>
      <div class="saved-search-meta"><span>${search.is_complete ? "Pesquisa completa" : "Pesquisa com mais resultados disponíveis"}</span><span>Filtro: ${{ all: "Todas", new: "Não salvas", prospected: "Já salvas", lead: "Já adicionadas como lead" }[search.prospect_filter] || "Todas"}</span>${search.guide_city ? `<span>Guia: ${escapeHtml(search.guide_city)}</span>` : ""}<span>Atualizada ${formatDate(search.updated_at, { day: "2-digit", month: "short", year: "numeric" })}</span></div>
    </div><div class="saved-search-actions"><button class="button primary small" type="button" data-action="open-saved-search" data-id="${escapeHtml(search.id)}">Abrir pesquisa</button><button class="button ghost small" type="button" data-action="delete-saved-search" data-id="${escapeHtml(search.id)}">Excluir</button></div>
  </article>`).join("")}</div>`;
}

async function loadSavedSearches({ render = true } = {}) {
  if (isLocalDemo || !state.user) return [];
  state.mapsSavedSearchesLoading = true;
  if (render) renderMapsSearch();
  try {
    state.mapsSavedSearches = await rest("saved_place_searches", { query: `owner_id=eq.${state.user.id}&select=id,name,keyword,locality,guide_state,guide_city,prospect_filter,result_count,is_complete,last_opened_at,created_at,updated_at&order=updated_at.desc&limit=100` }) || [];
    return state.mapsSavedSearches;
  } finally {
    state.mapsSavedSearchesLoading = false;
    if (render) renderMapsSearch();
  }
}

async function loadSavedSearchResults(savedSearchId) {
  if (isLocalDemo) return [];
  const rows = await rest("saved_place_search_results", { query: `saved_search_id=eq.${savedSearchId}&select=place_id,name,address,phone,website,cnpj,rating,rating_count,maps_url,position&order=position.asc&limit=150` }) || [];
  return rows.map((row) => ({ id: row.place_id, name: row.name, address: row.address || "", phone: row.phone || "", website: row.website || "", cnpj: row.cnpj || "", rating: row.rating == null ? null : Number(row.rating), ratingCount: Number(row.rating_count || 0), mapsUrl: row.maps_url || "", position: row.position }));
}

async function persistSavedSearchResults(savedSearchId) {
  if (isLocalDemo || !savedSearchId) return;
  await rest("saved_place_search_results", { method: "DELETE", query: `saved_search_id=eq.${savedSearchId}`, prefer: "return=minimal" });
  const rows = state.mapsResults.slice(0, 150).map((place, position) => ({ saved_search_id: savedSearchId, place_id: String(place.id), name: place.name, address: place.address || "", phone: place.phone || "", website: place.website || "", cnpj: place.cnpj || "", rating: place.rating ?? null, rating_count: place.ratingCount ?? null, maps_url: place.mapsUrl || "", position }));
  if (rows.length) await rest("saved_place_search_results", { method: "POST", body: rows, prefer: "return=minimal" });
  await rest("saved_place_searches", { method: "PATCH", query: `id=eq.${savedSearchId}`, body: { result_count: state.mapsResults.length, is_complete: !state.mapsHasMore, updated_at: new Date().toISOString() }, prefer: "return=minimal" });
}

async function saveCurrentSearch() {
  if (isLocalDemo || !state.mapsSearched || !state.mapsResults.length) return;
  const defaultName = `${state.mapsKeyword} · ${state.mapsLocality}`;
  const name = window.prompt("Dê um nome para esta pesquisa:", defaultName)?.trim();
  if (!name) return;
  if (name.length < 2) { toast("Use um nome com pelo menos 2 caracteres.", "error"); return; }
  const current = state.mapsSavedSearches.find((item) => item.name.trim().toLowerCase() === name.toLowerCase());
  const body = { name, keyword: mapsCacheValue(state.mapsKeyword), locality: mapsCacheValue(state.mapsLocality), guide_state: state.mapsGuideState || null, guide_city: state.mapsGuideCity || null, prospect_filter: state.mapsProspectFilter || "all", result_count: state.mapsResults.length, is_complete: !state.mapsHasMore, updated_at: new Date().toISOString() };
  let savedSearchId = current?.id || null;
  if (current) {
    await rest("saved_place_searches", { method: "PATCH", query: `id=eq.${current.id}`, body, prefer: "return=minimal" });
  } else {
    const created = await rest("saved_place_searches", { method: "POST", body: { owner_id: state.user.id, ...body }, prefer: "return=representation" });
    savedSearchId = created?.[0]?.id || null;
  }
  await persistSavedSearchResults(savedSearchId);
  state.mapsActiveSavedSearchId = savedSearchId;
  await loadSavedSearches();
  toast("Pesquisa salva. Você poderá reabri-la sem consumir a Serper.");
}

async function openSavedSearch(id) {
  const saved = state.mapsSavedSearches.find((item) => item.id === id);
  if (!saved) return;
  state.mapsSubtab = "new";
  state.mapsActiveSavedSearchId = saved.id;
  state.mapsKeyword = saved.keyword;
  state.mapsLocality = saved.locality;
  state.mapsGuideState = saved.guide_state || "";
  state.mapsGuideCity = saved.guide_city || "";
  state.mapsProspectFilter = saved.prospect_filter || "all";
  state.mapsSelectedPlaceIds = [];
  state.mapsLoading = true;
  state.mapsError = "";
  renderMapsSearch();
  try {
    const savedPlaces = await loadSavedSearchResults(saved.id).catch(() => []);
    const cachedPlaces = savedPlaces.length ? savedPlaces : await loadCachedPlaces(state.mapsKeyword, state.mapsLocality);
    state.mapsResults = dedupePlaces(cachedPlaces);
    const run = await loadSearchRun(state.mapsKeyword, state.mapsLocality).catch(() => null);
    state.mapsSearchCenter = run?.search_center || "";
    state.mapsSearchBatch = Math.max(0, Math.ceil(state.mapsResults.length / 20) - 1);
    state.mapsHasMore = state.mapsResults.length < 150 && !run?.completed_at;
    await loadPlaceReferences(state.mapsResults);
    state.mapsSearched = true;
    await rest("saved_place_searches", { method: "PATCH", query: `id=eq.${saved.id}`, body: { last_opened_at: new Date().toISOString(), updated_at: new Date().toISOString() }, prefer: "return=minimal" });
    toast(`${state.mapsResults.length} resultado(s) carregado(s) do histórico, sem consumir a Serper.`);
  } catch (error) {
    state.mapsError = error.message;
  } finally {
    state.mapsLoading = false;
    renderMapsSearch();
  }
}

async function deleteSavedSearch(id) {
  const saved = state.mapsSavedSearches.find((item) => item.id === id);
  if (!saved || !window.confirm(`Excluir a pesquisa salva “${saved.name}”? Os resultados em cache não serão apagados.`)) return;
  await rest("saved_place_searches", { method: "DELETE", query: `id=eq.${id}`, prefer: "return=minimal" });
  await loadSavedSearches();
  toast("Pesquisa salva excluída.");
}

function renderMapsSearch() {
  const section = $("#view-maps");
  if (!section) return;
  const content = state.mapsSubtab === "saved"
    ? `<section class="panel saved-searches-panel">${savedSearchesMarkup()}</section>`
    : `<section class="maps-search-layout">
        <section class="panel">
          <form id="maps-search-form" class="form-grid">
            <label class="field"><span>Palavra-chave</span><input id="maps-keyword" required minlength="2" placeholder="Ex.: dentista" value="${escapeHtml(state.mapsKeyword)}" /></label>
            <label class="field"><span>Cidade – região</span><input id="maps-locality" required minlength="2" placeholder="Ex.: Mogi das Cruzes - SP" value="${escapeHtml(state.mapsLocality)}" /></label>
            <button class="button primary" type="submit" ${state.mapsLoading ? "disabled" : ""}>${state.mapsLoading ? "Buscando…" : "Buscar no Maps"}</button>
          </form>
        </section>
        ${cityGuideMarkup()}
      </section>
      <section class="panel">${mapsResultsMarkup()}</section>`;
  section.innerHTML = `
    ${pageHead("PROSPECÇÃO", "Buscar leads no Maps", "Encontre clínicas e profissionais por palavra-chave e cidade usando o Google Maps.")}
    ${mapsSavedTabsMarkup()}
    ${content}`;
  $("#maps-search-form")?.addEventListener("submit", handleMapsSearch);
  bindCityGuide();
}

function cityGuideMarkup() {
  const stateOptions = CITY_GUIDE_STATES.map(([code, name]) => `<option value="${code}" ${state.mapsGuideState === code ? "selected" : ""}>${name}</option>`).join("");
  const cities = cityGuideData?.states?.[state.mapsGuideState] || [];
  const cityOptions = cities.map((city) => `<option value="${escapeHtml(city.ibgeCode)}" ${state.mapsGuideCity === city.name ? "selected" : ""}>${escapeHtml(city.name)} — ${city.population.toLocaleString("pt-BR")} hab.</option>`).join("");
  return `<aside class="panel maps-city-guide">
    <div class="maps-guide-head"><span class="eyebrow">GUIA TERRITORIAL</span><h2>Cidades por população</h2><p>Dados oficiais do IBGE (estimativa 2025). Mostrando municípios com mais de 70 mil habitantes.</p></div>
    <label class="field"><span>Estado</span><select id="maps-guide-state"><option value="">Selecione um estado</option>${stateOptions}</select></label>
    <label class="field"><span>Cidade acima de 70 mil habitantes</span><select id="maps-guide-city" ${state.mapsGuideState && !cityGuideData ? "disabled" : ""}><option value="">${state.mapsGuideState ? (cityGuideData ? "Selecione uma cidade" : "Carregando cidades…") : "Selecione primeiro o estado"}</option>${cityOptions}</select></label>
    <small class="maps-guide-note">Ao escolher uma cidade, ela será preenchida no campo Cidade – região da busca.</small>
  </aside>`;
}

async function ensureCityGuideData() {
  if (cityGuideData) return cityGuideData;
  if (!cityGuidePromise) {
    cityGuidePromise = fetch("/data/cities-by-state.json", { cache: "force-cache" }).then((response) => {
      if (!response.ok) throw new Error("Não foi possível carregar o guia de cidades.");
      return response.json();
    }).then((data) => {
      cityGuideData = data;
      return data;
    });
  }
  return cityGuidePromise;
}

function bindCityGuide() {
  const stateSelect = $("#maps-guide-state");
  const citySelect = $("#maps-guide-city");
  if (!stateSelect || !citySelect) return;
  stateSelect.addEventListener("change", async (event) => {
    state.mapsGuideState = event.target.value;
    state.mapsGuideCity = "";
    renderMapsSearch();
    if (!state.mapsGuideState) return;
    try {
      await ensureCityGuideData();
    } catch (error) {
      toast(error.message, "error");
    }
    renderMapsSearch();
  });
  citySelect.addEventListener("change", (event) => {
    const city = cityGuideData?.states?.[state.mapsGuideState]?.find((item) => item.ibgeCode === event.target.value);
    if (!city) return;
    state.mapsGuideCity = city.name;
    state.mapsLocality = `${city.name} - ${city.state}`;
    renderMapsSearch();
  });
}

function prospectStatusMeta(status) {
  return ({
    prospected: { label: "Salva", className: "prospected" },
    contacted: { label: "Em contato", className: "contacted" },
    converted: { label: "Convertida", className: "converted" },
    discarded: { label: "Descartada", className: "discarded" },
  })[status] || null;
}

function placeTracking(place) {
  return state.mapsReferences.find((reference) => reference.place_id === place.id) || null;
}

function filteredMapsResults() {
  if (state.mapsProspectFilter === "all") return state.mapsResults;
  return state.mapsResults.filter((place) => {
    const reference = placeTracking(place);
    if (state.mapsProspectFilter === "new") return !reference;
    if (state.mapsProspectFilter === "prospected") return Boolean(reference);
    if (state.mapsProspectFilter === "lead") return Boolean(reference?.lead_id);
    return true;
  });
}

function mapsSelectionToolbar(places) {
  const selectedCount = state.mapsSelectedPlaceIds.filter((id) => state.mapsResults.some((place) => place.id === id)).length;
  const stageOptions = state.stages.map((stage) => `<option value="${escapeHtml(stage.value)}">${escapeHtml(stage.label)}</option>`).join("");
  return `<div class="maps-selection-toolbar ${selectedCount ? "has-selection" : ""}">
    <div class="maps-selection-summary"><label class="maps-select-all"><input type="checkbox" id="maps-select-visible" ${places.length && places.every((place) => state.mapsSelectedPlaceIds.includes(place.id)) ? "checked" : ""} /><span></span></label><b>${selectedCount ? `${selectedCount} selecionada(s)` : "Selecione empresas"}</b><button class="text-button" type="button" data-action="select-visible-places">Selecionar resultados visíveis</button></div>
    ${selectedCount ? `<div class="maps-bulk-actions"><select id="maps-bulk-stage" class="compact-select" aria-label="Etapa do funil">${stageOptions}</select><button class="button primary small" type="button" data-action="add-selected-to-funnel">Adicionar ao funil</button><button class="button ghost small" type="button" data-action="clear-place-selection">Limpar seleção</button></div>` : ""}
  </div>`;
}

function mapsResultActions(place, reference, lead) {
  const action = lead ? `<button class="button ghost small" type="button" data-action="edit-lead" data-id="${escapeHtml(lead.id)}">Abrir lead</button>` : `<button class="button primary small" type="button" data-action="register-place-prospect" data-place-id="${escapeHtml(place.id)}">${reference ? "Atualizar prospecção" : "Registrar prospecção"}</button>`;
  return `${place.mapsUrl ? `<a class="button ghost small" href="${escapeHtml(place.mapsUrl)}" target="_blank" rel="noopener">Ver no Maps ↗</a>` : ""}${reference ? `<select class="compact-select prospect-status-select" data-place-id="${escapeHtml(place.id)}" aria-label="Status da prospecção"><option value="prospected" ${reference.status === "prospected" ? "selected" : ""}>Salva</option><option value="contacted" ${reference.status === "contacted" ? "selected" : ""}>Em contato</option><option value="converted" ${reference.status === "converted" ? "selected" : ""}>Convertida</option><option value="discarded" ${reference.status === "discarded" ? "selected" : ""}>Descartada</option></select>` : ""}${action}${lead ? "" : `<button class="button primary small" type="button" data-action="add-place-lead" data-place-id="${escapeHtml(place.id)}">+ Adicionar como lead</button>`}`;
}

function placeSelectionMarkup(place) {
  return `<label class="maps-place-selector" title="Selecionar ${escapeHtml(place.name)}"><input type="checkbox" class="maps-place-select" data-place-id="${escapeHtml(place.id)}" ${state.mapsSelectedPlaceIds.includes(place.id) ? "checked" : ""} /><span></span></label>`;
}

function mapsResultsMarkup() {
  if (state.mapsLoading) return `<div class="loading">${escapeHtml(state.mapsStatusMessage || "Buscando no Google Maps…")}</div>`;
  if (state.mapsError) {
    const retryButton = state.mapsPendingJobId ? `<button class="button primary small" type="button" data-action="retry-pending-search">Verificar de novo</button>` : "";
    return `<div class="google-calendar-state error">${escapeHtml(state.mapsError)} ${retryButton}</div>`;
  }
  if (!state.mapsSearched) return emptyState("⌖", "Busque por leads no Maps", "Digite uma palavra-chave (ex.: dentista) e uma cidade para encontrar clínicas e profissionais.", "");
  if (!state.mapsResults.length) return emptyState("⌖", "Nada encontrado", "Tente outra palavra-chave ou cidade.", "");
  const places = filteredMapsResults();
  const filter = `<div class="maps-results-toolbar"><div><b>${state.mapsResults.length} empresa(s) encontrada(s)</b>${state.mapsResults.length < 150 && state.mapsHasMore ? " · ainda há mais resultados" : ""}</div><div class="maps-results-toolbar-actions"><select id="maps-prospect-filter" class="compact-select"><option value="all" ${state.mapsProspectFilter === "all" ? "selected" : ""}>Todas</option><option value="new" ${state.mapsProspectFilter === "new" ? "selected" : ""}>Não salvas</option><option value="prospected" ${state.mapsProspectFilter === "prospected" ? "selected" : ""}>Já salvas</option><option value="lead" ${state.mapsProspectFilter === "lead" ? "selected" : ""}>Já adicionadas como lead</option></select><button class="button ghost small" type="button" data-action="save-maps-search">Salvar pesquisa</button><div class="maps-view-toggle"><button class="${state.mapsViewMode === "cards" ? "active" : ""}" type="button" data-action="maps-view-cards">Cards</button><button class="${state.mapsViewMode === "list" ? "active" : ""}" type="button" data-action="maps-view-list">Lista</button></div></div></div>`;
  const more = state.mapsHasMore && state.mapsResults.length < 150 ? `<button class="button ghost maps-load-more" type="button" data-action="load-more-places">Buscar mais 20 (${state.mapsResults.length}/150)</button>` : "";
  const content = places.length ? (state.mapsViewMode === "list" ? `<div class="maps-results-list">${places.map(mapsResultListRow).join("")}</div>` : `<div class="maps-results">${places.map(mapsResultCard).join("")}</div>`) : emptyState("⌖", "Nenhuma empresa neste filtro", "Altere o filtro para visualizar os demais resultados.", "");
  return `${filter}${mapsSelectionToolbar(places)}${content}${more}`;
}

function mapsResultListRow(place) {
  const reference = placeTracking(place);
  const lead = state.leads.find((item) => item.place_id === place.id) || (reference?.lead_id ? state.leads.find((item) => item.id === reference.lead_id) : null);
  const status = prospectStatusMeta(reference?.status);
  const funnelTag = lead ? `<span class="funnel-badge">● No funil</span>` : "";
  const statusMarkup = `${status ? `<span class="prospect-badge ${status.className}">${status.label}</span>` : `<span class="prospect-badge new">Nova</span>`}${funnelTag}`;
  const rowState = `${status ? `prospect-state-${status.className}` : "prospect-state-new"}${lead ? " maps-in-funnel" : ""}`;
  return `<div class="maps-result-row ${rowState}">${placeSelectionMarkup(place)}<div class="maps-list-main"><b>${escapeHtml(place.name)}</b><span>${escapeHtml(place.address || "Sem endereço")}</span></div><div class="maps-list-contact"><span>${escapeHtml(place.phone || "Sem telefone")}</span>${place.rating ? `<span>★ ${place.rating} (${place.ratingCount || 0})</span>` : ""}</div><div class="maps-list-status">${statusMarkup}</div><div class="maps-list-actions">${mapsResultActions(place, reference, lead)}</div></div>`;
}

function mapsResultCard(place) {
  const reference = placeTracking(place);
  const lead = state.leads.find((item) => item.place_id === place.id) || (reference?.lead_id ? state.leads.find((item) => item.id === reference.lead_id) : null);
  const status = prospectStatusMeta(reference?.status);
  const funnelTag = lead ? `<span class="funnel-badge">● No funil</span>` : "";
  const statusMarkup = `${status ? `<span class="prospect-badge ${status.className}">${status.label}${reference.prospected_at ? ` · ${formatDate(reference.prospected_at, { day: "2-digit", month: "short" })}` : ""}</span>` : `<span class="prospect-badge new">Nova</span>`}${funnelTag}`;
  const cardStateClass = `${status ? `prospect-state-${status.className}` : "prospect-state-new"}${lead ? " maps-in-funnel" : ""}`;
  return `<div class="lead-card maps-result-card ${cardStateClass}">${placeSelectionMarkup(place)}
    <div class="lead-card-top"><div><h3>${escapeHtml(place.name)}</h3><div class="maps-status-line">${statusMarkup}</div></div>${place.rating ? `<span class="lead-card-value">★ ${place.rating} (${place.ratingCount || 0})</span>` : ""}</div>
    <p>${escapeHtml(place.address)}</p>${place.phone ? `<p>${escapeHtml(place.phone)}</p>` : ""}<div class="maps-result-actions">${mapsResultActions(place, reference, lead)}</div>
  </div>`;
}

function mapsCacheValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/\s*[-,]\s*/g, " ").toLocaleLowerCase("pt-BR");
}

async function loadCachedPlaces(keyword, locality) {
  if (isLocalDemo) return [];
  const normalizedKeyword = mapsCacheValue(keyword);
  const normalizedLocality = mapsCacheValue(locality);
  const params = new URLSearchParams({
    owner_id: `eq.${state.user.id}`,
    keyword: `eq.${normalizedKeyword}`,
    locality: `eq.${normalizedLocality}`,
    is_complete: "eq.true",
    select: "place_id,name,address,phone,website,cnpj,rating,rating_count,maps_url,position",
    order: "position.asc",
    limit: "150",
  });
  const rows = await rest("place_search_cache", { query: params.toString() });
  return rows.map((row) => ({
    id: row.place_id,
    name: row.name,
    address: row.address || "",
    phone: row.phone || "",
    website: row.website || "",
    cnpj: row.cnpj || "",
    rating: row.rating ?? null,
    ratingCount: row.rating_count ?? null,
    mapsUrl: row.maps_url || "",
  }));
}

async function loadSearchRun(keyword, locality) {
  if (isLocalDemo) return null;
  const rows = await rest("place_search_runs", { query: `owner_id=eq.${state.user.id}&keyword=eq.${encodeURIComponent(mapsCacheValue(keyword))}&locality=eq.${encodeURIComponent(mapsCacheValue(locality))}&select=requested_count,returned_count,search_center,completed_at,pagination_version&limit=1` });
  return rows?.[0] || null;
}

async function saveSearchRun(keyword, locality, { returnedCount, center, completed = false } = {}) {
  if (isLocalDemo) return;
  await rest("place_search_runs", {
    method: "POST",
    query: "on_conflict=owner_id,keyword,locality",
    body: {
      owner_id: state.user.id,
      keyword: mapsCacheValue(keyword),
      locality: mapsCacheValue(locality),
      requested_count: 150,
      returned_count: returnedCount || 0,
      search_center: center || null,
      pagination_version: 2,
      ...(completed ? { completed_at: new Date().toISOString() } : { completed_at: null }),
    },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

async function loadPlaceReferences(places = state.mapsResults) {
  if (isLocalDemo) {
    state.mapsReferences = [];
    return [];
  }
  const rows = await rest("place_references", {
    query: `owner_id=eq.${state.user.id}&select=place_id,status,prospected_at,lead_id,notes&limit=1000`,
  });
  const ids = new Set(places.map((place) => String(place.id)));
  state.mapsReferences = rows.filter((row) => ids.has(String(row.place_id)));
  return state.mapsReferences;
}

async function savePlacesCache(keyword, locality, places) {
  if (isLocalDemo || !places.length) return;
  const normalizedKeyword = mapsCacheValue(keyword);
  const normalizedLocality = mapsCacheValue(locality);
  const rows = places.slice(0, 150).map((place, position) => ({
    owner_id: state.user.id,
    keyword: normalizedKeyword,
    locality: normalizedLocality,
    place_id: String(place.id || `${normalizedKeyword}-${normalizedLocality}-${position}`),
    name: place.name,
    address: place.address || "",
    phone: place.phone || "",
    website: place.website || "",
    cnpj: place.cnpj || "",
    rating: place.rating ?? null,
    rating_count: place.ratingCount ?? null,
    maps_url: place.mapsUrl || "",
    position,
    is_complete: true,
  }));
  await rest("place_search_cache", {
    method: "DELETE",
    query: `owner_id=eq.${state.user.id}&keyword=eq.${encodeURIComponent(normalizedKeyword)}&locality=eq.${encodeURIComponent(normalizedLocality)}`,
    prefer: "return=minimal",
  });
  await rest("place_search_cache", {
    method: "POST",
    query: "on_conflict=owner_id,keyword,locality,place_id",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

function dedupePlaces(places) {
  const seen = new Set();
  return places.filter((place) => {
    const key = String(place.id || `${mapsCacheValue(place.name)}|${mapsCacheValue(place.address)}`);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 150).map((place, index) => ({ ...place, position: index + 1 }));
}

async function fetchSerperPlacesBatch(keyword, locality, batch = 0, center = "") {
  const params = new URLSearchParams({ keyword, locality, batch: String(batch), ...(center ? { center } : {}), _: String(Date.now()) });
  const response = await fetch(`/api/places-search?${params}`, {
    headers: { Authorization: `Bearer ${state.session.access_token}` },
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(payload?.places)) throw new Error(payload?.message || "Não foi possível concluir a busca.");
  return payload;
}

async function handleMapsSearch(event) {
  event.preventDefault();
  const keyword = $("#maps-keyword").value.trim();
  const locality = $("#maps-locality").value.trim();
  if (keyword.length < 2 || locality.length < 2) {
    toast("Informe uma palavra-chave e uma cidade válidas.", "error");
    return;
  }
  state.mapsKeyword = keyword;
  state.mapsLocality = locality;
  state.mapsResults = [];
  state.mapsReferences = [];
  state.mapsSearchBatch = 0;
  state.mapsSearchCenter = "";
  state.mapsHasMore = false;
  state.mapsProspectFilter = "all";
  state.mapsSelectedPlaceIds = [];
  state.mapsActiveSavedSearchId = null;
  state.mapsError = "";
  state.mapsPendingJobId = null;
  renderMapsSearch();
  try {
    if (isLocalDemo) throw new Error("A busca no Maps não está disponível no modo demonstração.");
    state.mapsLoading = true;
    state.mapsStatusMessage = "Verificando resultados salvos…";
    renderMapsSearch();
    try {
      const cachedPlaces = await loadCachedPlaces(keyword, locality);
      const cachedRun = await loadSearchRun(keyword, locality).catch(() => null);
      if (cachedPlaces.length && Number(cachedRun?.pagination_version || 0) >= 2) {
        state.mapsResults = dedupePlaces(cachedPlaces);
        state.mapsSearchCenter = cachedRun?.search_center || "";
        state.mapsSearchBatch = Math.max(0, Math.ceil(state.mapsResults.length / 20) - 1);
        state.mapsHasMore = state.mapsResults.length < 150 && !cachedRun?.completed_at;
        await loadPlaceReferences(state.mapsResults);
        state.mapsSearched = true;
        state.mapsLoading = false;
        state.mapsStatusMessage = "";
        renderMapsSearch();
        toast(`${state.mapsResults.length} resultado(s) carregado(s) do histórico, sem consumir a Serper.`);
        return;
      }
    } catch (cacheError) {
      console.warn("maps_cache_read_failed", cacheError?.message);
    }
    state.mapsStatusMessage = "Buscando empresas na Serper…";
    renderMapsSearch();
    const payload = await fetchSerperPlacesBatch(keyword, locality, 0);
    state.mapsSearchCenter = payload.center || "";
    state.mapsHasMore = Boolean(payload.hasMore);
    await applyPlacesResults(payload.places, keyword, locality);
    await saveSearchRun(keyword, locality, { returnedCount: state.mapsResults.length, center: state.mapsSearchCenter, completed: !state.mapsHasMore }).catch((runError) => console.warn("maps_run_write_failed", runError?.message));
  } catch (error) {
    state.mapsError = error.message;
    state.mapsLoading = false;
    state.mapsStatusMessage = "";
    renderMapsSearch();
  }
}

async function loadMorePlaces() {
  if (state.mapsLoading || !state.mapsHasMore || state.mapsResults.length >= 150) return;
  state.mapsLoading = true;
  state.mapsError = "";
  state.mapsStatusMessage = `Buscando mais empresas… (${Math.min(state.mapsResults.length + 20, 150)}/150)`;
  renderMapsSearch();
  try {
    const nextBatch = state.mapsSearchBatch + 1;
    const payload = await fetchSerperPlacesBatch(state.mapsKeyword, state.mapsLocality, nextBatch, state.mapsSearchCenter);
    state.mapsSearchBatch = nextBatch;
    state.mapsHasMore = Boolean(payload.hasMore) && state.mapsResults.length < 150;
    await applyPlacesResults(payload.places, state.mapsKeyword, state.mapsLocality, true, true);
    await saveSearchRun(state.mapsKeyword, state.mapsLocality, { returnedCount: state.mapsResults.length, center: state.mapsSearchCenter, completed: !state.mapsHasMore }).catch((runError) => console.warn("maps_run_write_failed", runError?.message));
    if (state.mapsActiveSavedSearchId) await persistSavedSearchResults(state.mapsActiveSavedSearchId).catch((savedError) => console.warn("saved_search_results_write_failed", savedError?.message));
  } catch (error) {
    state.mapsError = error.message;
    state.mapsLoading = false;
    state.mapsStatusMessage = "";
    renderMapsSearch();
  }
}

async function retryPendingSearch() {
  if (!state.mapsPendingJobId) return;
  state.mapsError = "";
  state.mapsLoading = true;
  state.mapsStatusMessage = "Verificando o job em andamento…";
  renderMapsSearch();
  try {
    await pollAndApply(state.mapsPendingJobId, state.mapsKeyword, state.mapsLocality, false);
  } catch (error) {
    state.mapsError = error.message;
    state.mapsLoading = false;
    state.mapsStatusMessage = "";
    renderMapsSearch();
  }
}

async function applyPlacesResults(places, keyword, locality, logUsage = true, append = false) {
  try {
    state.mapsResults = dedupePlaces(append ? [...state.mapsResults, ...(Array.isArray(places) ? places : [])] : (Array.isArray(places) ? places : []));
    state.mapsSearched = true;
    state.mapsPendingJobId = null;
    try {
      await savePlacesCache(keyword, locality, state.mapsResults);
      await loadPlaceReferences(state.mapsResults);
    } catch (cacheError) {
      console.warn("maps_cache_write_failed", cacheError?.message);
    }
    if (logUsage) await rest("place_search_usage", { method: "POST", body: { owner_id: state.user.id, keyword, locality } });
  } finally {
    state.mapsLoading = false;
    state.mapsStatusMessage = "";
    renderMapsSearch();
  }
}

async function pollAndApply(jobId, keyword, locality, logUsage = true) {
  const places = await pollPlacesJob(jobId);
  await applyPlacesResults(places, keyword, locality, logUsage);
}

async function pollPlacesJob(jobId) {
  const maxAttempts = 20;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    state.mapsStatusMessage = `Buscando empresas… (${attempt * 3}s)`;
    renderMapsSearch();
    const params = new URLSearchParams({ jobId, _: String(Date.now()) });
    const response = await fetch(`/api/places-search-status?${params}`, {
      headers: { Authorization: `Bearer ${state.session.access_token}` },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "Não foi possível checar o status da busca.");
    if (payload.status === "done") return payload.places || [];
    if (payload.status === "error") { state.mapsPendingJobId = null; throw new Error(payload.message || "A busca falhou."); }
  }
  state.mapsPendingJobId = jobId;
  throw new Error("A busca ainda está processando. Clique em \"Verificar de novo\" em vez de buscar de novo.");
}

async function savePlaceReference(place, { status = "prospected", notes = null, leadId = null } = {}) {
  if (!place || isLocalDemo) return null;
  const body = {
    owner_id: state.user.id,
    place_id: place.id,
    keyword: state.mapsKeyword,
    locality: state.mapsLocality,
    status,
    prospected_at: new Date().toISOString(),
    ...(notes ? { notes } : {}),
    ...(leadId ? { lead_id: leadId } : {}),
  };
  const rows = await rest("place_references", {
    method: "POST",
    query: "on_conflict=owner_id,place_id",
    body,
    prefer: "resolution=merge-duplicates,return=representation",
  });
  const saved = rows?.[0] || body;
  state.mapsReferences = [...state.mapsReferences.filter((item) => item.place_id !== place.id), saved];
  return saved;
}

async function registerPlaceProspect(placeId) {
  const place = state.mapsResults.find((item) => item.id === placeId);
  if (!place) return;
  try {
    const notes = window.prompt("Observação da prospecção (opcional):", "") || null;
    await savePlaceReference(place, { status: "prospected", notes });
    renderMapsSearch();
    toast(`${place.name} registrada como salva.`);
  } catch (error) {
    toast(error.message || "Não foi possível registrar a prospecção.", "error");
  }
}

async function updatePlaceStatus(placeId, status) {
  const place = state.mapsResults.find((item) => item.id === placeId);
  if (!place) return;
  try {
    await savePlaceReference(place, { status });
    renderMapsSearch();
    toast("Status da prospecção atualizado.");
  } catch (error) {
    toast(error.message || "Não foi possível atualizar o status.", "error");
  }
}

function togglePlaceSelection(placeId, checked) {
  const selected = new Set(state.mapsSelectedPlaceIds);
  checked ? selected.add(placeId) : selected.delete(placeId);
  state.mapsSelectedPlaceIds = [...selected];
  renderMapsSearch();
}

function selectVisiblePlaces() {
  const visible = filteredMapsResults();
  const selected = new Set(state.mapsSelectedPlaceIds);
  const allSelected = visible.length > 0 && visible.every((place) => selected.has(place.id));
  visible.forEach((place) => allSelected ? selected.delete(place.id) : selected.add(place.id));
  state.mapsSelectedPlaceIds = [...selected];
  renderMapsSearch();
}

async function addSelectedPlacesToFunnel() {
  const selected = state.mapsResults.filter((place) => state.mapsSelectedPlaceIds.includes(place.id));
  const stage = $("#maps-bulk-stage")?.value || state.stages[0]?.value || "new";
  if (!selected.length) { toast("Selecione pelo menos uma empresa.", "error"); return; }
  if (!selected.some((place) => !state.leads.some((lead) => lead.place_id === place.id))) { toast("As empresas selecionadas já estão no funil.", "error"); return; }
  const stageLabel = state.stages.find((item) => item.value === stage)?.label || stage;
  if (!window.confirm(`Adicionar ${selected.length} empresa(s) ao funil na etapa “${stageLabel}”?`)) return;
  let added = 0;
  let skipped = 0;
  try {
    for (const place of selected) {
      const existing = state.leads.find((lead) => lead.place_id === place.id);
      if (existing) { skipped += 1; continue; }
      const created = await store.saveLead({ name: place.name, clinic_name: place.name, website: place.website || "", cnpj: place.cnpj || "", stage, source: "Prospecção ativa", whatsapp: place.phone || "", email: "", deal_value: state.settings.deal_value, next_follow_up: null, notes: [place.address, place.mapsUrl].filter(Boolean).join("\\n"), place_id: place.id });
      state.leads.unshift(created);
      await savePlaceReference(place, { status: "prospected", leadId: created.id });
      added += 1;
    }
    state.mapsSelectedPlaceIds = [];
    renderMapsSearch();
    toast(`${added} empresa(s) adicionada(s) ao funil${skipped ? ` · ${skipped} já existia(m)` : ""}.`);
  } catch (error) {
    toast(error.message || "Não foi possível adicionar as empresas ao funil.", "error");
    renderMapsSearch();
  }
}

async function addPlaceAsLead(placeId) {
  const place = state.mapsResults.find((item) => item.id === placeId);
  if (!place) return;
  const reference = placeTracking(place);
  const existingLead = state.leads.find((lead) => lead.place_id === place.id) || (reference?.lead_id ? state.leads.find((lead) => lead.id === reference.lead_id) : null);
  if (existingLead) {
    openLeadDialog(existingLead);
    toast("Esta empresa já está cadastrada como lead.");
    return;
  }
  state.mapsPendingLeadPlace = place;
  openLeadDialog({
    clinic_name: place.name,
    website: place.website || "",
    cnpj: place.cnpj || "",
    whatsapp: place.phone || "",
    source: "Prospecção ativa",
    place_id: place.id,
    notes: [place.address, place.mapsUrl].filter(Boolean).join("\n"),
  });
  if (isLocalDemo) return;
  try {
    await savePlaceReference(place, { status: "prospected" });
    renderMapsSearch();
  } catch (error) {
    toast(error.message || "Não foi possível registrar a prospecção.", "error");
  }
}

function googleEventRow(event) {
  const start = event.allDay
    ? formatDate(event.start.slice(0, 10), { day: "2-digit", month: "short" })
    : formatDate(event.start, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  const meta = [event.allDay ? "Dia inteiro" : "Google Agenda", event.location].filter(Boolean).join(" · ");
  return `<a class="activity-row google-event-row" href="${escapeHtml(event.htmlLink || "https://calendar.google.com/calendar/u/0/r")}" target="_blank" rel="noopener"><span class="google-event-icon">G</span><span class="activity-main"><b>${escapeHtml(event.title)}</b><span>${escapeHtml(meta)}</span></span><span class="activity-time">${start}</span></a>`;
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

function renderSettings() {
  const templates = normalizeWhatsAppTemplates(state.settings.whatsapp_templates);
  const defaultIndex = Math.min(Math.max(0, Number(state.settings.whatsapp_default_template) || 0), templates.length - 1);
  const usageToday = whatsappTemplateUsageToday();
  const templateRows = templates.map((template, index) => `<div class="message-template-row" data-template-row><div class="message-template-row-head"><label class="field"><span>Nome do modelo ${index + 1}</span><input data-message-template-label maxlength="80" value="${escapeHtml(template.label)}" placeholder="Ex.: Apresentação inicial" /></label><button type="button" class="icon-button message-template-remove" data-action="remove-message-template" data-index="${index}" aria-label="Remover modelo" title="Remover modelo">×</button></div><label class="field"><span>Mensagem</span><textarea data-message-template-body maxlength="800" rows="3" placeholder="Use {{nome}}, {{empresa}}, {{cidade}} e {{remetente}}.">${escapeHtml(template.body)}</textarea></label><div class="template-limit-grid"><label class="field"><span>Limite diário (0 = sem limite)</span><input data-message-template-limit type="number" min="0" max="1000" step="1" value="${whatsappTemplateLimit(index)}" /></label><div class="template-usage-note">Usados hoje: <b>${Number(usageToday[String(index)] || 0)}</b></div></div></div>`).join("");
  $("#view-settings").innerHTML = `${pageHead("CONFIGURAÇÕES", "Mensagens do WhatsApp", "Escolha e edite modelos para abrir no WhatsApp. O envio continua sendo manual, em uma nova aba.", `<span class="date-chip">${templates.length} modelos</span>`)}<div class="settings-layout"><section class="panel"><div class="panel-head"><div><h2>Biblioteca de mensagens</h2><span>Personalize os textos sem automatizar o envio</span></div><button type="button" class="button ghost" data-action="add-message-template">+ Novo modelo</button></div><form id="message-settings-form" class="form-stack"><div class="settings-callout"><b>Campos disponíveis</b><span><code>{{nome}}</code> primeiro nome · <code>{{empresa}}</code> empresa · <code>{{cidade}}</code> cidade · <code>{{remetente}}</code> seu nome</span></div><div class="message-template-list">${templateRows}</div><div class="form-grid"><label class="field"><span>Modelo padrão ao clicar em WhatsApp</span><select data-message-default>${templates.map((template, index) => `<option value="${index}" ${index === defaultIndex ? "selected" : ""}>${escapeHtml(template.label)}</option>`).join("")}</select></label><label class="field"><span>Limite diário de referência</span><input data-message-daily-limit type="number" min="0" max="1000" step="1" value="${Math.max(0, Number(state.settings.whatsapp_daily_limit) || 0)}" /></label></div><label class="check-field"><input data-message-randomize type="checkbox" ${state.settings.whatsapp_randomize_templates ? "checked" : ""} /><span>Escolher aleatoriamente um modelo configurado ao abrir o WhatsApp</span></label><div class="modal-actions"><span class="spacer"></span><button class="button primary" type="submit">Salvar mensagens</button></div></form></section><section class="panel settings-help"><div class="panel-head"><div><h2>Como usar</h2><span>Fluxo manual e responsável</span></div></div><p>Ao clicar em WhatsApp no card, o modelo padrão — ou um dos modelos sorteado se a opção estiver ativada — será personalizado com os dados do lead e aberto no WhatsApp oficial. O CRM registra o lead como <b>Contatado</b>, mas nunca envia a mensagem sozinho.</p><p>Use modelos claros, identifique sua empresa e interrompa o contato quando a pessoa pedir. O limite por modelo é diário, reinicia automaticamente e serve apenas para organização manual; 0 significa sem limite.</p></section></div>`;
  $("#message-settings-form").addEventListener("submit", saveMessageSettings);
}

function collectMessageTemplatesFromForm() {
  return $$('[data-template-row]', $('#message-settings-form')).map((row, index) => ({
    label: row.querySelector('[data-message-template-label]')?.value.trim() || `Mensagem ${index + 1}`,
    body: row.querySelector('[data-message-template-body]')?.value.trim() || '',
  })).filter((template) => template.body);
}

function updateMessageDefaultOptions(preferredIndex = null) {
  const select = $('[data-message-default]');
  if (!select) return;
  const templates = collectMessageTemplatesFromForm();
  const current = preferredIndex === null ? Number(select.value) || 0 : Number(preferredIndex) || 0;
  select.innerHTML = templates.map((template, index) => `<option value="${index}">${escapeHtml(template.label)}</option>`).join('');
  select.value = String(Math.min(Math.max(0, current), Math.max(0, templates.length - 1)));
}

function addMessageTemplateRow() {
  const list = $('.message-template-list');
  if (!list) return;
  const index = list.children.length;
  list.insertAdjacentHTML('beforeend', `<div class="message-template-row" data-template-row><div class="message-template-row-head"><label class="field"><span>Nome do modelo ${index + 1}</span><input data-message-template-label maxlength="80" value="Novo modelo" placeholder="Ex.: Apresentação inicial" /></label><button type="button" class="icon-button message-template-remove" data-action="remove-message-template" data-index="${index}" aria-label="Remover modelo" title="Remover modelo">×</button></div><label class="field"><span>Mensagem</span><textarea data-message-template-body maxlength="800" rows="3" placeholder="Use {{nome}}, {{empresa}}, {{cidade}} e {{remetente}}."></textarea></label></div>`);
  updateMessageDefaultOptions();
  list.lastElementChild?.querySelector('[data-message-template-label]')?.focus();
}

function removeMessageTemplateRow(index) {
  const list = $('.message-template-list');
  if (!list || list.children.length <= 1) return toast('Mantenha pelo menos um modelo de mensagem.', 'error');
  const row = list.children[Number(index)];
  if (!row) return;
  const selected = Number($('[data-message-default]')?.value) || 0;
  row.remove();
  $$('.message-template-row').forEach((item, position) => {
    item.querySelector('span').textContent = `Nome do modelo ${position + 1}`;
    item.querySelector('[data-action="remove-message-template"]').dataset.index = String(position);
  });
  updateMessageDefaultOptions(Math.max(0, selected - (Number(index) < selected ? 1 : 0)));
}

async function saveMessageSettings(event) {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  const templates = collectMessageTemplatesFromForm();
  if (!templates.length) return toast('Cadastre pelo menos um modelo com texto.', 'error');
  submit.disabled = true;
  try {
    const defaultIndex = Math.min(Math.max(0, Number($('[data-message-default]')?.value) || 0), templates.length - 1);
    const limits = Object.fromEntries([...document.querySelectorAll('[data-message-template-limit]')].map((input, index) => [String(index), Math.min(1000, Math.max(0, Number(input.value) || 0))]));
    const payload = { whatsapp_templates: templates, whatsapp_default_template: defaultIndex, whatsapp_randomize_templates: Boolean($('[data-message-randomize]')?.checked), whatsapp_template_limits: limits, whatsapp_daily_limit: Math.min(1000, Math.max(0, Number($('[data-message-daily-limit]')?.value) || 0)) };
    state.settings = { ...state.settings, ...(await store.saveSettings(state.month, payload)), ...payload, whatsapp_templates: normalizeWhatsAppTemplates(payload.whatsapp_templates) };
    renderSettings();
    toast('Biblioteca de mensagens salva.');
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    const nextSubmit = $('#message-settings-form button[type="submit"]');
    if (nextSubmit) nextSubmit.disabled = false;
  }
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

async function handleLeadDialogClick(event) {
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (action.dataset.action === "toggle-activity") await toggleActivity(action.dataset.id);
  if (action.dataset.action === "edit-activity") openEditActivityDialog(action.dataset.id);
  if (action.dataset.action === "delete-activity") await deleteActivity(action.dataset.id);
}

async function handleMainClick(event) {
  const viewTarget = event.target.closest("[data-view-target]");
  if (viewTarget) return navigate(viewTarget.dataset.viewTarget);
  const action = event.target.closest("[data-action]");
  if (!action) return;
  if (suppressLeadClick && action.dataset.action === "edit-lead") return;
  if (action.dataset.action === "open-lead") openLeadDialog();
  if (action.dataset.action === "edit-lead") openLeadDialog(state.leads.find((lead) => lead.id === action.dataset.id));
  if (action.dataset.action === "delete-lead-card") { await deleteLeadFromCard(action.dataset.id); return; }
  if (action.dataset.action === "open-whatsapp") await openLeadWhatsApp(action.dataset.id);
  if (action.dataset.action === "add-message-template") addMessageTemplateRow();
  if (action.dataset.action === "remove-message-template") removeMessageTemplateRow(action.dataset.index);
  if (action.dataset.action === "open-lead-activity") { openActivityDialog(null, action.dataset.id); return; }
  if (action.dataset.action === "edit-activity") { openEditActivityDialog(action.dataset.id); return; }
  if (action.dataset.action === "toggle-lead-contact") await toggleLeadContact(action.dataset.id);
  if (action.dataset.action === "open-activity") openActivityDialog();
  if (action.dataset.action === "manage-stages") openStageDialog();
  if (action.dataset.action === "connect-google-calendar") connectGoogleCalendar();
  if (action.dataset.action === "refresh-google-calendar") await loadGoogleEvents({ notify: true });
  if (action.dataset.action === "sync-google-activity") await syncActivityToGoogle(action.dataset.id);
  if (action.dataset.action === "delete-activity") await deleteActivity(action.dataset.id);
  if (action.dataset.action === "save-metric") await saveMetricRow(action.closest("tr"));
  if (action.dataset.action === "toggle-activity") await toggleActivity(action.dataset.id);
  if (action.dataset.action === "add-place-lead") await addPlaceAsLead(action.dataset.placeId);
  if (action.dataset.action === "register-place-prospect") await registerPlaceProspect(action.dataset.placeId);
  if (action.dataset.action === "load-more-places") await loadMorePlaces();
  if (action.dataset.action === "save-maps-search") await saveCurrentSearch();
  if (action.dataset.action === "select-visible-places") selectVisiblePlaces();
  if (action.dataset.action === "clear-place-selection") { state.mapsSelectedPlaceIds = []; renderMapsSearch(); }
  if (action.dataset.action === "add-selected-to-funnel") await addSelectedPlacesToFunnel();
  if (action.dataset.action === "maps-view-cards") { state.mapsViewMode = "cards"; renderMapsSearch(); }
  if (action.dataset.action === "maps-view-list") { state.mapsViewMode = "list"; renderMapsSearch(); }
  if (action.dataset.action === "maps-subtab-new") { state.mapsSubtab = "new"; renderMapsSearch(); }
  if (action.dataset.action === "maps-subtab-saved") { state.mapsSubtab = "saved"; await loadSavedSearches(); }
  if (action.dataset.action === "open-saved-search") await openSavedSearch(action.dataset.id);
  if (action.dataset.action === "delete-saved-search") await deleteSavedSearch(action.dataset.id);
  if (action.dataset.action === "retry-pending-search") await retryPendingSearch();
  if (action.dataset.action === "open-day") openDayDialog(action.dataset.date);
}

async function handleMainChange(event) {
  if (["dashboard-month", "metrics-month", "goals-month"].includes(event.target.id)) {
    state.month = event.target.value;
    state.week = "all";
    try { await reloadPeriod(); } catch (error) { toast(error.message, "error"); }
  }
  if (event.target.id === "maps-prospect-filter") {
    state.mapsProspectFilter = event.target.value;
    renderMapsSearch();
  }
  if (event.target.id === "maps-select-visible") selectVisiblePlaces();
  if (event.target.classList.contains("maps-place-select")) togglePlaceSelection(event.target.dataset.placeId, event.target.checked);
  if (event.target.classList.contains("prospect-status-select")) updatePlaceStatus(event.target.dataset.placeId, event.target.value);
  if (event.target.id === "agenda-month") {
    state.agendaMonth = event.target.value;
    renderAgenda();
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

function leadActivitiesMarkup(lead) {
  if (!lead) return "";
  const activities = state.activities.filter((activity) => activity.lead_id === lead.id).sort((a, b) => String(a.completed_at || "").localeCompare(String(b.completed_at || "")) || String(a.due_at || "9999").localeCompare(String(b.due_at || "9999")));
  if (!activities.length) return `<div class="lead-activities-empty">Nenhuma atividade cadastrada para este lead.</div>`;
  return `<div class="lead-activities-head"><div><span class="eyebrow">ATIVIDADES</span><h3>Atividades do lead</h3></div><span class="date-chip">${activities.length}</span></div><div class="lead-activities-list">${activities.map((activity) => `<div class="lead-activity-row ${activity.completed_at ? "done" : ""}"><button type="button" class="activity-check ${activity.completed_at ? "done" : ""}" data-action="toggle-activity" data-id="${activity.id}" aria-label="${activity.completed_at ? "Desconcluir" : "Concluir"} atividade"></button><div><b>${escapeHtml(activity.title)}</b><span>${activity.due_at ? formatDate(activity.due_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sem prazo"} · ${activityKindLabel(activity.kind)}</span></div><button type="button" class="lead-activity-edit" data-action="edit-activity" data-id="${activity.id}" aria-label="Editar atividade" title="Editar atividade">✎</button><button type="button" class="activity-delete" data-action="delete-activity" data-id="${activity.id}" aria-label="Excluir atividade" title="Excluir atividade">×</button></div>`).join("")}</div>`;
}

function renderLeadActivitiesPanel(lead) {
  const panel = $("#lead-activities-panel");
  if (!panel) return;
  panel.classList.toggle("hidden", !lead);
  panel.innerHTML = lead ? leadActivitiesMarkup(lead) : "";
}

function openLeadDialog(lead = null) {
  $("#lead-form").reset();
  $("#lead-id").value = lead?.id || "";
  $("#lead-dialog-title").textContent = lead ? "Editar lead" : "Novo lead";
  $("#delete-lead").classList.toggle("hidden", !lead);
  $("#lead-activity-button").classList.toggle("hidden", !lead);
  $("#lead-name").value = lead?.name || "";
  $("#lead-clinic").value = lead?.clinic_name || "";
  $("#lead-website").value = lead?.website || "";
  $("#lead-cnpj").value = lead?.cnpj || "";
  $("#lead-whatsapp").value = lead?.whatsapp || "";
  $("#lead-email").value = lead?.email || "";
  $("#lead-source").value = lead?.source || "Prospecção ativa";
  $("#lead-stage").value = lead?.stage || "new";
  $("#lead-value").value = lead?.deal_value ?? state.settings.deal_value;
  $("#lead-follow-up").value = lead?.next_follow_up || "";
  $("#lead-notes").value = lead?.notes || "";
  renderLeadActivitiesPanel(lead);
  $("#lead-dialog").showModal();
}

async function saveLeadFromDialog(event) {
  event.preventDefault();
  const submit = event.submitter || event.target.querySelector('[type="submit"]');
  const originalLabel = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Salvando…";
  const id = $("#lead-id").value;
  const payload = {
    ...(id ? { id } : {}), name: $("#lead-name").value.trim(), clinic_name: $("#lead-clinic").value.trim() || null,
    website: $("#lead-website").value.trim() || null, cnpj: $("#lead-cnpj").value.trim() || null,
    ...(state.mapsPendingLeadPlace && !id ? { place_id: state.mapsPendingLeadPlace.id } : {}),
    whatsapp: $("#lead-whatsapp").value.trim() || null,
    email: $("#lead-email").value.trim() || null, source: $("#lead-source").value, stage: $("#lead-stage").value,
    deal_value: Number($("#lead-value").value) || null, next_follow_up: $("#lead-follow-up").value || null, notes: $("#lead-notes").value.trim() || null,
  };
  try {
    const saved = await store.saveLead(payload);
    state.leads = id
      ? state.leads.map((lead) => lead.id === saved.id ? saved : lead)
      : [saved, ...state.leads.filter((lead) => lead.id !== saved.id)];
    if (state.mapsPendingLeadPlace && !id) {
      try { await savePlaceReference(state.mapsPendingLeadPlace, { status: "prospected", leadId: saved.id }); } catch (referenceError) { console.warn("place_reference_lead_link_failed", referenceError?.message); }
      state.mapsPendingLeadPlace = null;
      await loadPlaceReferences(state.mapsResults);
    }
    $("#lead-dialog").close();
    renderDashboard(); renderLeads(); renderAgenda();
    toast(id ? "Lead atualizado." : "Lead adicionado ao pipeline.");
  } catch (error) {
    toast(error.message, "error");
  } finally {
    submit.disabled = false;
    submit.textContent = originalLabel;
  }
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

function updateActivityKindControls() {
  const isMeeting = $("#activity-kind").value === "meeting";
  const meetField = $("#activity-meet-field");
  if (!meetField) return;
  meetField.classList.toggle("hidden", !isMeeting);
  if (!isMeeting) $("#activity-meet").checked = false;
}

function openActivityDialog(presetDate = null, leadId = null) {
  state.editingActivityId = null;
  $("#activity-dialog-title").textContent = "Nova atividade";
  $("#activity-submit").textContent = "Criar atividade";
  $("#activity-form").reset();
  $("#activity-lead").innerHTML = `<option value="">Atividade geral</option>${state.leads.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  $("#activity-lead").value = leadId || "";
  $("#activity-lead-field").classList.toggle("hidden", Boolean(leadId));
  $("#activity-lead").disabled = Boolean(leadId);
  $("#activity-due").value = `${presetDate || todayIso()}T09:00`;
  const googleReady = state.calendarConnected || hasValidGoogleToken();
  $("#activity-google").checked = false;
  $("#activity-google").disabled = false;
  $("#activity-google-field").title = googleReady ? "Criar também no Google Agenda" : "Conecte o Google Agenda antes de salvar para enviar o evento";
  $("#activity-meet").checked = false;
  $("#activity-meet").disabled = false;
  $("#activity-meet-field").title = googleReady ? "Gerar uma sala do Google Meet" : "Conecte o Google Agenda antes de gerar o Meet";
  updateActivityKindControls();
  $("#activity-dialog").showModal();
}

function openEditActivityDialog(activityId) {
  const activity = state.activities.find((entry) => entry.id === activityId);
  if (!activity) return toast("Atividade não encontrada.", "error");
  openActivityDialog(null, activity.lead_id);
  state.editingActivityId = activity.id;
  $("#activity-dialog-title").textContent = "Editar atividade";
  $("#activity-submit").textContent = "Salvar alterações";
  $("#activity-title").value = activity.title || "";
  $("#activity-kind").value = activity.kind || "follow_up";
  $("#activity-due").value = activity.due_at ? new Date(activity.due_at).toISOString().slice(0, 16) : "";
  $("#activity-google").checked = false;
  $("#activity-google").disabled = true;
  $("#activity-meet").checked = false;
  $("#activity-meet").disabled = true;
  updateActivityKindControls();
}

async function connectGoogleCalendar() {
  if (state.calendarConnected) {
    toast("O Google Agenda já está conectado.");
    return;
  }
  try {
    const params = new URLSearchParams({
      provider: "google",
      redirect_to: `${location.origin}${location.pathname}?calendar=connected`,
      scopes: GOOGLE_CALENDAR_SCOPE,
      access_type: "offline",
      prompt: "consent",
    });
    const oauthUrl = `${SUPABASE_URL}/auth/v1/authorize?${params}`;
    location.assign(oauthUrl);
  } catch (error) {
    const message = /provider|enabled|unsupported/i.test(error.message)
      ? "A conexão Google ainda precisa das credenciais OAuth do projeto. Ela não será marcada como ativa antes da autorização real."
      : error.message;
    toast(message, "error");
  }
}

function activityGoogleEvent(activity) {
  const lead = state.leads.find((item) => item.id === activity.lead_id);
  const event = googleCalendarEvent({
    title: activity.title,
    dueAt: activity.due_at,
    details: `CRM Agência Líder Local\nLead: ${lead?.name || "Atividade geral"}\nTipo: ${activityKindLabel(activity.kind)}`,
  });
  if (event && activity.add_google_meet) {
    event.conferenceDataVersion = 1;
    event.conferenceData = {
      createRequest: {
        requestId: `crm-${crypto.randomUUID()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }
  return event;
}

async function createGoogleEvent(activity) {
  if (!hasValidGoogleToken()) throw new Error("Conecte novamente o Google Agenda para autorizar este envio.");
  const event = activityGoogleEvent(activity);
  if (!event) throw new Error("Informe data e horário antes de enviar ao Google Agenda.");
  const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${state.googleAccessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  const payload = await response.json().catch(() => null);
  if (response.status === 401) {
    clearGoogleConnection();
    renderAgenda();
    throw new Error("A autorização do Google expirou. Conecte o Google Agenda novamente.");
  }
  if (!response.ok) throw new Error(payload?.error?.message || "O Google não aceitou a criação do evento.");
  return store.saveActivityGoogleEvent(activity.id, payload);
}

async function syncActivityToGoogle(id) {
  const activity = state.activities.find((item) => item.id === id);
  if (!activity || activity.google_event_id) return;
  try {
    await createGoogleEvent(activity);
    state.activities = await store.getActivities();
    await loadGoogleEvents();
    toast("Evento criado no seu Google Agenda.");
  } catch (error) { toast(error.message, "error"); }
}

async function saveActivityFromDialog(event) {
  event.preventDefault();
  const wantsMeet = $("#activity-kind").value === "meeting" && $("#activity-meet").checked;
  const openInGoogle = $("#activity-google").checked || wantsMeet;
  const payload = {
    title: $("#activity-title").value.trim(), lead_id: $("#activity-lead").value || null,
    kind: $("#activity-kind").value, due_at: $("#activity-due").value ? new Date($("#activity-due").value).toISOString() : null,
  };
  try {
    const savedActivity = state.editingActivityId
      ? await store.updateActivity(state.editingActivityId, payload)
      : await store.saveActivity(payload);
    const created = { ...savedActivity, add_google_meet: wantsMeet };
    let googleError = null;
    let syncedGoogleActivity = null;
    const googleWindow = openInGoogle ? window.open("about:blank", "_blank") : null;
    if (openInGoogle) {
      try {
        syncedGoogleActivity = await createGoogleEvent(created);
        if (!googleWindow) toast("O navegador bloqueou a nova aba. Permita pop-ups para abrir o evento do Google Agenda.", "error");
      } catch (error) {
        googleError = error;
        if (googleWindow && !googleWindow.closed) googleWindow.close();
      }
    }
    state.activities = await store.getActivities();
    $("#activity-dialog").close();
    renderDashboard(); renderLeads(); renderAgenda();
    const activityLead = state.leads.find((item) => item.id === created.lead_id);
    if ($("#lead-dialog")?.open && activityLead) renderLeadActivitiesPanel(activityLead);
    if (openInGoogle && !googleError) {
      await loadGoogleEvents();
      const googleUrl = syncedGoogleActivity?.google_event_url;
      if (googleUrl && googleWindow && !googleWindow.closed) googleWindow.location.href = googleUrl;
      else if (googleUrl && !googleWindow) window.open(googleUrl, "_blank");
    }
    toast(googleError ? `Atividade salva no CRM, mas não no Google: ${googleError.message}` : state.editingActivityId ? "Atividade atualizada." : openInGoogle ? "Atividade criada no CRM e o evento foi aberto no Google Agenda." : "Atividade criada.", googleError ? "error" : "success");
    state.editingActivityId = null;
  } catch (error) {
    toast(error.message, "error");
  }
}

async function deleteActivity(id) {
  const current = state.activities.find((activity) => activity.id === id);
  if (!current) return;
  if (!window.confirm(`Excluir a atividade “${current.title}”? Esta ação não pode ser desfeita.`)) return;
  try {
    await store.deleteActivity(id);
    state.activities = await store.getActivities();
    renderDashboard(); renderLeads(); renderAgenda();
    const lead = state.leads.find((item) => item.id === current.lead_id);
    if ($("#lead-dialog")?.open && lead) renderLeadActivitiesPanel(lead);
    toast("Atividade excluída.");
  } catch (error) { toast(error.message, "error"); }
}

async function toggleActivity(id) {
  const current = state.activities.find((activity) => activity.id === id);
  if (!current) return;
  try {
    await store.toggleActivity(id, !current.completed_at);
    state.activities = await store.getActivities();
    const lead = state.leads.find((item) => item.id === current.lead_id);
    renderDashboard(); renderLeads(); renderAgenda();
    if ($("#lead-dialog")?.open && lead) renderLeadActivitiesPanel(lead);
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
    toast("Metas do mês atualizadas. Todo o funil foi recalculado.");
  } catch (error) { toast(error.message, "error"); }
}

bootstrap();
