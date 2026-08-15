import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config.js";
import { DEFAULT_SETTINGS, aggregateMetrics, deriveGoals, googleCalendarEvent, monthBounds, moveLeadToStage, normalizeGoogleEvents, progress, reassignStage, weekOfMonth, whatsappWebUrl } from "./calculations.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const todayIso = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => todayIso().slice(0, 7);
const isLocalDemo = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).get("demo") === "1";
const SESSION_KEY = "agencia-lider-local.crm.session.v1";
const GOOGLE_TOKEN_KEY = "agencia-lider-local.crm.google-token.v1";
const GOOGLE_TOKEN_EXPIRY_KEY = "agencia-lider-local.crm.google-token-expiry.v1";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
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
  googleAccessToken: sessionStorage.getItem(GOOGLE_TOKEN_KEY),
  googleEvents: [],
  googleEventsLoading: false,
  googleEventsError: "",
  month: currentMonth(),
  agendaMonth: currentMonth(),
  week: "all",
  view: "dashboard",
  loading: false,
  mapsKeyword: "",
  mapsLocality: "",
  mapsResults: [],
  mapsLoading: false,
  mapsError: "",
  mapsSearched: false,
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

function syncGoogleConnection() {
  const hasGoogleIdentity = Boolean(state.user?.identities?.some((identity) => identity.provider === "google"));
  state.calendarConnected = hasGoogleIdentity && hasValidGoogleToken();
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
  $$(".modal-close").forEach((button) => button.addEventListener("click", () => $("#lead-dialog").close()));
  $$(".activity-close").forEach((button) => button.addEventListener("click", () => $("#activity-dialog").close()));
  $$(".stage-close").forEach((button) => button.addEventListener("click", () => $("#stage-dialog").close()));
  $("#lead-form").addEventListener("submit", saveLeadFromDialog);
  $("#delete-lead").addEventListener("click", deleteCurrentLead);
  $("#activity-form").addEventListener("submit", saveActivityFromDialog);
  $("#stage-add-form").addEventListener("submit", addPipelineStage);
  $("#stage-dialog").addEventListener("click", handleStageDialogClick);
  $("#day-dialog").addEventListener("click", handleDayDialogClick);
  $("#day-dialog").addEventListener("close", () => { openDayIso = null; });
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
  syncGoogleConnection();
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
    const oauthError = sessionStorage.getItem("agencia-lider-local.crm.oauth-error");
    const oauthSuccess = sessionStorage.getItem("agencia-lider-local.crm.oauth-success");
    sessionStorage.removeItem("agencia-lider-local.crm.oauth-error");
    sessionStorage.removeItem("agencia-lider-local.crm.oauth-success");
    if (oauthError) toast(oauthError, "error");
    if (oauthSuccess && state.calendarConnected) toast("Google Agenda conectado de verdade.");
    if (state.calendarConnected) await loadGoogleEvents();
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
  renderMapsSearch();
  renderGoals();
}

function pageHead(eyebrow, title, subtitle, actions = "", inlineStatus = "") {
  return `<header class="page-head ${inlineStatus ? "dashboard-head" : ""}"><div class="page-title"><span class="eyebrow">${eyebrow}</span><div class="page-title-row"><h1>${title}</h1>${inlineStatus}</div><p>${subtitle}</p></div><div class="head-actions">${actions}</div></header>`;
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
  const whatsappAction = lead.whatsapp ? `<button type="button" draggable="false" class="whatsapp-button" data-action="open-whatsapp" data-id="${lead.id}" aria-label="Abrir conversa com ${escapeHtml(lead.name)} no WhatsApp Web"><span aria-hidden="true">◉</span> Abrir WhatsApp</button>` : "";
  return `<article class="lead-card" draggable="true" data-action="edit-lead" data-id="${lead.id}" title="Arraste para mudar de etapa ou clique para editar"><div class="lead-card-top"><div><h3>${escapeHtml(lead.name)}</h3><p>${escapeHtml(lead.clinic_name || lead.specialty || "Sem clínica informada")}</p></div><span class="lead-card-value">${formatCurrency(lead.deal_value || state.settings.deal_value)}</span></div><div class="lead-meta"><span>${escapeHtml(lead.source || "Sem origem")}</span><span class="lead-follow-up ${overdue ? "overdue" : ""}">${lead.next_follow_up ? `Follow-up ${formatDate(lead.next_follow_up)}` : "Sem follow-up"}</span></div>${whatsappAction}</article>`;
}

function openLeadWhatsApp(leadId) {
  const lead = state.leads.find((item) => item.id === leadId);
  if (!lead) return toast("Lead não encontrado.", "error");
  const firstName = String(lead.name || "").trim().split(/\s+/)[0] || "tudo bem";
  const sender = String(state.user?.user_metadata?.full_name || "Damião").trim().split(/\s+/)[0] || "Damião";
  const message = `Olá, ${firstName}! Tudo bem? Aqui é ${sender}, da Agência Líder Local. Estou entrando em contato para dar continuidade à nossa conversa.`;
  const url = whatsappWebUrl({ phone: lead.whatsapp, message });
  if (!url) return toast("Cadastre um WhatsApp válido para este lead.", "error");
  window.open(url, "_blank", "noopener,noreferrer");
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
  return `<tr data-metric-date="${row.metric_date}" class="${isWeekend ? "weekend-row" : ""}"><td class="metric-date ${isToday ? "today-cell" : ""}">${formatDate(row.metric_date, { day: "2-digit", month: "2-digit", weekday: "short" })}</td><td><span class="week-tag">S${weekOfMonth(row.metric_date)}</span></td>${fields.map((field) => `<td><input class="metric-input" data-field="${field}" type="number" min="0" value="${Number(row[field]) || 0}" aria-label="${field}" /></td>`).join("")}<td data-revenue>${formatCurrency((Number(row.sales) || 0) * state.settings.deal_value)}</td><td><button class="button small save-row" data-action="save-metric">Salvar</button></td></tr>`;
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
    ? `<button class="button google-button connected" data-action="refresh-google-calendar" ${state.googleEventsLoading ? "disabled" : ""}>${state.googleEventsLoading ? "Atualizando…" : "↻ Atualizar Google"}</button>`
    : `<button class="button google-button" data-action="connect-google-calendar">G Conectar Google Agenda</button>`;
  const cells = calendarCells(state.agendaMonth);
  $("#view-agenda").innerHTML = `
    ${pageHead("AGENDA COMERCIAL", "Calendário de atividades", "Clique em um dia para ver os agendamentos.", `${monthInput("agenda-month", state.agendaMonth)}${googleActions}<button class="button primary" data-action="open-activity">+ Nova atividade</button>`)}
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
  return `<div class="activity-row"><button class="activity-check ${activity.completed_at ? "done" : ""}" data-action="toggle-activity" data-id="${activity.id}" aria-label="${activity.completed_at ? "Reabrir" : "Concluir"} atividade"></button><div class="activity-main"><b>${escapeHtml(activity.title)}</b><span>${escapeHtml(lead?.name || "Atividade geral")} · ${activityKindLabel(activity.kind)}</span>${calendarAction}</div><span class="activity-time ${isOverdue(activity) ? "overdue" : ""}">${activity.due_at ? formatDate(activity.due_at, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "Sem prazo"}</span></div>`;
}

function renderMapsSearch() {
  const section = $("#view-maps");
  if (!section) return;
  section.innerHTML = `
    ${pageHead("PROSPECÇÃO", "Buscar leads no Maps", "Encontre clínicas e profissionais por palavra-chave e cidade usando o Google Maps.")}
    <section class="panel">
      <form id="maps-search-form" class="form-grid">
        <label class="field"><span>Palavra-chave</span><input id="maps-keyword" required minlength="2" placeholder="Ex.: dentista" value="${escapeHtml(state.mapsKeyword)}" /></label>
        <label class="field"><span>Cidade</span><input id="maps-locality" required minlength="2" placeholder="Ex.: Mogi das Cruzes - SP" value="${escapeHtml(state.mapsLocality)}" /></label>
        <button class="button primary" type="submit" ${state.mapsLoading ? "disabled" : ""}>${state.mapsLoading ? "Buscando…" : "Buscar no Maps"}</button>
      </form>
    </section>
    <section class="panel">${mapsResultsMarkup()}</section>`;
  $("#maps-search-form").addEventListener("submit", handleMapsSearch);
}

function mapsResultsMarkup() {
  if (state.mapsLoading) return `<div class="loading">Buscando no Google Maps…</div>`;
  if (state.mapsError) return `<div class="google-calendar-state error">${escapeHtml(state.mapsError)}</div>`;
  if (!state.mapsSearched) return emptyState("⌖", "Busque por leads no Maps", "Digite uma palavra-chave (ex.: dentista) e uma cidade para encontrar clínicas e profissionais.", "");
  if (!state.mapsResults.length) return emptyState("⌖", "Nada encontrado", "Tente outra palavra-chave ou cidade.", "");
  return `<div class="maps-results">${state.mapsResults.map(mapsResultCard).join("")}</div>`;
}

function mapsResultCard(place) {
  return `<div class="lead-card maps-result-card">
    <div class="lead-card-top"><h3>${escapeHtml(place.name)}</h3>${place.rating ? `<span class="lead-card-value">★ ${place.rating} (${place.ratingCount || 0})</span>` : ""}</div>
    <p>${escapeHtml(place.address)}</p>
    ${place.phone ? `<p>${escapeHtml(place.phone)}</p>` : ""}
    <div class="maps-result-actions">
      ${place.mapsUrl ? `<a class="button ghost small" href="${escapeHtml(place.mapsUrl)}" target="_blank" rel="noopener">Ver no Maps ↗</a>` : ""}
      <button class="button primary small" type="button" data-action="add-place-lead" data-place-id="${escapeHtml(place.id)}">+ Adicionar como lead</button>
    </div>
  </div>`;
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
  state.mapsLoading = true;
  state.mapsError = "";
  renderMapsSearch();
  try {
    if (isLocalDemo) throw new Error("A busca no Maps não está disponível no modo demonstração.");
    const params = new URLSearchParams({ keyword, locality });
    const response = await fetch(`/api/places-search?${params}`, {
      headers: { Authorization: `Bearer ${state.session.access_token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(payload?.message || "Não foi possível buscar no Google Maps.");
    state.mapsResults = payload.places || [];
    state.mapsSearched = true;
    await rest("place_search_usage", { method: "POST", body: { owner_id: state.user.id, keyword, locality } });
  } catch (error) {
    state.mapsError = error.message;
  } finally {
    state.mapsLoading = false;
    renderMapsSearch();
  }
}

async function addPlaceAsLead(placeId) {
  const place = state.mapsResults.find((item) => item.id === placeId);
  if (!place) return;
  openLeadDialog({
    clinic_name: place.name,
    whatsapp: place.phone || "",
    notes: [place.address, place.website, place.mapsUrl].filter(Boolean).join("\n"),
  });
  if (isLocalDemo) return;
  try {
    await rest("place_references", {
      method: "POST",
      query: "on_conflict=owner_id,place_id",
      body: { owner_id: state.user.id, place_id: place.id, keyword: state.mapsKeyword, locality: state.mapsLocality },
      prefer: "resolution=merge-duplicates,return=representation",
    });
  } catch {
    // Referência é só um registro auxiliar de deduplicação; não deve travar o fluxo de criar o lead.
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
  if (action.dataset.action === "open-whatsapp") openLeadWhatsApp(action.dataset.id);
  if (action.dataset.action === "open-activity") openActivityDialog();
  if (action.dataset.action === "manage-stages") openStageDialog();
  if (action.dataset.action === "connect-google-calendar") connectGoogleCalendar();
  if (action.dataset.action === "refresh-google-calendar") await loadGoogleEvents({ notify: true });
  if (action.dataset.action === "sync-google-activity") await syncActivityToGoogle(action.dataset.id);
  if (action.dataset.action === "save-metric") await saveMetricRow(action.closest("tr"));
  if (action.dataset.action === "toggle-activity") await toggleActivity(action.dataset.id);
  if (action.dataset.action === "add-place-lead") await addPlaceAsLead(action.dataset.placeId);
  if (action.dataset.action === "open-day") openDayDialog(action.dataset.date);
}

async function handleMainChange(event) {
  if (["dashboard-month", "metrics-month", "goals-month"].includes(event.target.id)) {
    state.month = event.target.value;
    state.week = "all";
    try { await reloadPeriod(); } catch (error) { toast(error.message, "error"); }
  }
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
  const submit = event.submitter || event.target.querySelector('[type="submit"]');
  const originalLabel = submit.textContent;
  submit.disabled = true;
  submit.textContent = "Salvando…";
  const id = $("#lead-id").value;
  const payload = {
    ...(id ? { id } : {}), name: $("#lead-name").value.trim(), clinic_name: $("#lead-clinic").value.trim() || null,
    specialty: $("#lead-specialty").value.trim() || null, whatsapp: $("#lead-whatsapp").value.trim() || null,
    email: $("#lead-email").value.trim() || null, source: $("#lead-source").value, stage: $("#lead-stage").value,
    deal_value: Number($("#lead-value").value) || null, next_follow_up: $("#lead-follow-up").value || null, notes: $("#lead-notes").value.trim() || null,
  };
  try {
    const saved = await store.saveLead(payload);
    state.leads = id
      ? state.leads.map((lead) => lead.id === saved.id ? saved : lead)
      : [saved, ...state.leads.filter((lead) => lead.id !== saved.id)];
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

function openActivityDialog(presetDate = null) {
  $("#activity-form").reset();
  $("#activity-lead").innerHTML = `<option value="">Atividade geral</option>${state.leads.map((item) => `<option value="${item.id}">${escapeHtml(item.name)}</option>`).join("")}`;
  $("#activity-due").value = `${presetDate || todayIso()}T09:00`;
  $("#activity-google").checked = state.calendarConnected;
  $("#activity-google").disabled = !state.calendarConnected;
  $("#activity-google").closest("label").title = state.calendarConnected ? "Criar também no Google Agenda" : "Conecte o Google Agenda primeiro";
  $("#activity-dialog").showModal();
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
      skip_http_redirect: "true",
    });
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user/identities/authorize?${params}`, {
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${state.session.access_token}` },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.url) throw new Error(payload?.msg || payload?.message || "Não foi possível iniciar a conexão com o Google.");
    location.assign(payload.url);
  } catch (error) {
    const message = /provider|enabled|unsupported/i.test(error.message)
      ? "A conexão Google ainda precisa das credenciais OAuth do projeto. Ela não será marcada como ativa antes da autorização real."
      : error.message;
    toast(message, "error");
  }
}

function activityGoogleEvent(activity) {
  const lead = state.leads.find((item) => item.id === activity.lead_id);
  return googleCalendarEvent({
    title: activity.title,
    dueAt: activity.due_at,
    details: `CRM Agência Líder Local\nLead: ${lead?.name || "Atividade geral"}\nTipo: ${activityKindLabel(activity.kind)}`,
  });
}

async function createGoogleEvent(activity) {
  if (!state.calendarConnected || !hasValidGoogleToken()) throw new Error("Conecte novamente o Google Agenda para autorizar este envio.");
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
  const openInGoogle = $("#activity-google").checked;
  const payload = {
    title: $("#activity-title").value.trim(), lead_id: $("#activity-lead").value || null,
    kind: $("#activity-kind").value, due_at: $("#activity-due").value ? new Date($("#activity-due").value).toISOString() : null,
  };
  try {
    const created = await store.saveActivity(payload);
    let googleError = null;
    if (openInGoogle) {
      try { await createGoogleEvent(created); } catch (error) { googleError = error; }
    }
    state.activities = await store.getActivities();
    $("#activity-dialog").close();
    renderDashboard(); renderAgenda();
    if (openInGoogle && !googleError) await loadGoogleEvents();
    toast(googleError ? `Atividade criada no CRM, mas não no Google: ${googleError.message}` : openInGoogle ? "Atividade criada no CRM e no Google Agenda." : "Atividade criada.", googleError ? "error" : "success");
  } catch (error) {
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
    toast("Metas do mês atualizadas. Todo o funil foi recalculado.");
  } catch (error) { toast(error.message, "error"); }
}

bootstrap();
