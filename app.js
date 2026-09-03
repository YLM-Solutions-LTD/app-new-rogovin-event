(function () {
  "use strict";

  const { createMachine, assign, interpret } = XState;
  const APP_NAME = "new-rogovin-event";
  const ALLOWED_HOST_ORIGINS = [
    "https://mnt.ylm.co.il",
    "https://simplylog.ylm.co.il",
    "https://app.simplylog.co.il",
    "https://www.simplylog.co.il"
  ];
  const RTL_LANGS = ["he", "ar", "fa", "ur"];
  const DEFAULT_CATEGORIES = [
    { id: "cleaning", name: "ניקיון", icon: "▰" },
    { id: "elevators", name: "מעליות", icon: "⌃" },
    { id: "parking", name: "חניה", icon: "●" },
    { id: "plumbing", name: "אינסטלציה", icon: "●" },
    { id: "construction", name: "בינוי", icon: "▣" },
    { id: "maintenance", name: "אחזקה", icon: "⚒" },
    { id: "electricity", name: "חשמל", icon: "⚡" },
    { id: "air-conditioning", name: "מיזוג אוויר", icon: "❄" },
    { id: "access", name: "קידוד כרטיסים", icon: "▤" }
  ];
  const DEMO_LOCATIONS = [{ id: "default", name: "המיקום שלי" }];
  const appEl = document.getElementById("app");

  function parsePayload(data) {
    if (typeof data === "string") return JSON.parse(data);
    return data && typeof data === "object" ? data : {};
  }

  function readHostContext() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => { if (!settled) { settled = true; window.removeEventListener("message", onMessage); resolve(value); } };
      const onMessage = (event) => {
        if (!ALLOWED_HOST_ORIGINS.includes(event.origin)) return;
        try { finish({ context: parsePayload(event.data), demo: false }); } catch (_) { /* Ignore malformed untrusted messages. */ }
      };
      window.addEventListener("message", onMessage);
      window.setTimeout(() => finish({ context: {}, demo: true }), 1800);
    });
  }

  function resolveLanguage(context) {
    const culture = String(context.CultureInfo || context.LanguageCode || "he").toLowerCase();
    const language = culture.split(/[-_]/)[0] || "he";
    const configured = String(context.LanguageDirection || "").toLowerCase();
    const direction = configured === "rtl" || configured === "ltr" ? configured : (RTL_LANGS.includes(language) ? "rtl" : "ltr");
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
    return { language, direction };
  }

  function parseAppConnections(configuration) {
    const result = {};
    for (const item of Array.isArray(configuration) ? configuration : []) {
      if (!item || item.Group !== "Connections" || typeof item.Name !== "string" || !item.Name.startsWith(APP_NAME)) continue;
      const key = item.Name.slice(APP_NAME.length).replace(/^[._:-]+/, "") || item.Name;
      let value = item.Value;
      if (typeof value === "string") { try { value = JSON.parse(value); } catch (_) {} }
      result[key] = value;
    }
    return result;
  }

  function createApiClient(runtime) {
    const baseUrl = String(runtime.ApiAddress || "").replace(/\/+$/, "");
    const tokenType = runtime.Token && runtime.Token.token_type || "bearer";
    const accessToken = runtime.Token && runtime.Token.access_token || "";
    return { request: async (path, options = {}) => {
      if (!baseUrl || !accessToken) throw new Error("AUTH_REQUIRED");
      const headers = Object.assign({}, options.headers || {}, { Authorization: `${tokenType} ${accessToken}`.trim() });
      let body = options.body;
      if (body && typeof body === "object" && !(body instanceof FormData)) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
      const response = await fetch(`${baseUrl}${path}`, { method: options.method || "GET", headers, body });
      if (!response.ok) { const detail = await response.text(); const error = new Error(detail || `HTTP ${response.status}`); error.status = response.status; throw error; }
      if (response.status === 204) return null;
      return (response.headers.get("content-type") || "").includes("json") ? response.json() : response.text();
    }};
  }

  function normalizeList(data, kind) {
    const list = Array.isArray(data) ? data : (data && (data.Items || data.items || data.Value || data.value)) || [];
    return list.map((item) => ({
      id: item.Id ?? item.id ?? item.Value ?? item.value,
      name: item.Name || item.name || item.Title || item.title || item.FullName || item.fullName,
      icon: item.Icon || item.icon || "◇"
    })).filter((item) => item.id != null && item.name && (kind !== "category" || item.icon));
  }

  function errorMessage(error) {
    if (error && (error.status === 401 || error.message === "AUTH_REQUIRED")) return "פג תוקף החיבור. יש לרענן את עמוד SimplyLog ולהתחבר מחדש.";
    if (error && error.status === 403) return "אין לך הרשאה לבצע את הפעולה. יש לפנות למנהל המערכת.";
    return "לא הצלחנו להשלים את הפעולה. אפשר לנסות שוב.";
  }

  const machine = createMachine({
    id: "newEvent", initial: "bootstrapping",
    context: { runtime: null, api: null, demo: false, locations: [], categories: [], result: null, error: "" },
    states: {
      bootstrapping: { invoke: { src: "bootstrap", onDone: { target: "loading", actions: assign((_, e) => e.data) }, onError: { target: "error", actions: assign({ error: (_, e) => errorMessage(e.data) }) } } },
      loading: { invoke: { src: "loadOptions", onDone: { target: "ready", actions: assign((_, e) => e.data) }, onError: { target: "error", actions: assign({ error: (_, e) => errorMessage(e.data) }) } } },
      ready: { on: { SUBMIT: "saving" } },
      saving: { invoke: { src: "saveEvent", onDone: { target: "success", actions: assign({ result: (_, e) => e.data }) }, onError: { target: "error", actions: assign({ error: (_, e) => errorMessage(e.data) }) } } },
      success: { on: { NEW_EVENT: { target: "ready", actions: assign({ result: null, error: "" }) } } },
      error: { on: { RETRY: "loading" } }
    }
  }, { services: {
    bootstrap: async () => {
      const received = await readHostContext();
      const language = resolveLanguage(received.context);
      const connections = parseAppConnections(received.context.Configuration);
      const runtime = Object.assign({}, received.context, { connections, language });
      return { runtime, api: createApiClient(runtime), demo: received.demo };
    },
    loadOptions: async (ctx) => {
      if (ctx.demo) return { locations: DEMO_LOCATIONS, categories: DEFAULT_CATEGORIES };
      const config = ctx.runtime.connections.app || ctx.runtime.connections.options || {};
      const locationPath = config.locationsEndpoint;
      const categoryPath = config.categoriesEndpoint;
      const [locationData, categoryData] = await Promise.all([
        locationPath ? ctx.api.request(locationPath) : Promise.resolve(config.locations || DEMO_LOCATIONS),
        categoryPath ? ctx.api.request(categoryPath) : Promise.resolve(config.categories || DEFAULT_CATEGORIES)
      ]);
      return { locations: normalizeList(locationData, "location"), categories: normalizeList(categoryData, "category") };
    },
    saveEvent: async (ctx, event) => {
      if (ctx.demo) { await new Promise((r) => setTimeout(r, 550)); return { id: "DEMO-001" }; }
      const config = ctx.runtime.connections.app || ctx.runtime.connections.options || {};
      const endpoint = config.createEndpoint || "/api/Events/Create";
      const form = event.form;
      const payload = { LocationEntityId: form.locationId, CategoryId: form.categoryId, Description: form.description };
      let result = await ctx.api.request(endpoint, { method: "POST", body: payload });
      const eventId = result && (result.Id || result.id || result.EventId || result.eventId);
      if (eventId && form.files.length && config.attachmentEndpoint) {
        for (const file of form.files) { const body = new FormData(); body.append(config.attachmentField || "file", file); await ctx.api.request(String(config.attachmentEndpoint).replace("{eventId}", eventId), { method: "POST", body }); }
      }
      return { id: eventId || "" };
    }
  }});

  function esc(value) { const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML; }
  function options(items) { return items.map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join(""); }
  function renderForm(ctx) {
    appEl.innerHTML = `<div class="shell"><section class="panel"><ol class="progress" aria-label="תהליך הדיווח"><li class="active"><span>1</span></li><li><span>2</span></li><li><span>3</span></li><li><span>4</span></li></ol><header><h1>דיווח על אירוע חדש</h1><p>בחרו את סוג האירוע, הוסיפו פרטים ושלחו.</p></header>${ctx.demo ? '<aside class="demo-note">ℹ️ <span><strong>מצב תצוגה מקדימה</strong><br>הטופס לא ישלח מידע עד לפתיחתו מתוך SimplyLog.</span></aside>' : ''}<form id="event-form" novalidate><div class="field"><label for="location">מיקום האירוע <span class="hint">(לא חובה)</span></label><select id="location"><option value="">בחרו מיקום</option>${options(ctx.locations)}</select></div><fieldset class="field" style="border:0;padding:0"><legend class="legend">סוג האירוע <span class="required">*</span></legend><div class="categories">${ctx.categories.map((c) => `<button class="category" type="button" data-id="${esc(c.id)}" aria-pressed="false"><span class="check">✓</span><span class="icon" aria-hidden="true">${esc(c.icon)}</span><span>${esc(c.name)}</span></button>`).join("")}</div><input id="category" type="hidden"></fieldset><div class="field"><label for="description">תיאור האירוע <span class="required">*</span></label><textarea id="description" maxlength="1000" placeholder="פרטו מה קרה, היכן ומתי"></textarea></div><div class="field"><label class="dropzone">⌁ <strong>צרפו קבצים או תמונות</strong><br><span class="hint">עד 10MB לקובץ</span><input id="attachments" type="file" multiple accept="image/*,.pdf"></label><ul id="file-list" class="files"></ul></div><p id="validation" class="validation" role="alert"></p><button class="submit" type="submit">שליחת הדיווח</button></form></section></div>`;
    let selected = "";
    appEl.querySelectorAll(".category").forEach((button) => button.addEventListener("click", () => {
      selected = button.dataset.id; appEl.querySelectorAll(".category").forEach((b) => { const active = b === button; b.classList.toggle("selected", active); b.setAttribute("aria-pressed", String(active)); });
    }));
    const fileInput = document.getElementById("attachments");
    fileInput.addEventListener("change", () => { document.getElementById("file-list").innerHTML = Array.from(fileInput.files).map((f) => `<li>${esc(f.name)} · ${Math.ceil(f.size / 1024)}KB</li>`).join(""); });
    document.getElementById("event-form").addEventListener("submit", (event) => {
      event.preventDefault(); const description = document.getElementById("description").value.trim(); const files = Array.from(fileInput.files); const validation = document.getElementById("validation");
      if (!selected || !description) { validation.textContent = "יש לבחור סוג אירוע ולמלא תיאור."; return; }
      if (files.some((f) => f.size > 10 * 1024 * 1024)) { validation.textContent = "אחד הקבצים גדול מ‑10MB."; return; }
      service.send({ type: "SUBMIT", form: { locationId: document.getElementById("location").value || null, categoryId: selected, description, files } });
    });
  }

  const service = interpret(machine).onTransition((state) => {
    if (!state.changed && !state.matches("bootstrapping")) return;
    if (state.matches("bootstrapping")) appEl.innerHTML = '<section class="status-card"><span class="spinner"></span><p>מתחברים ל‑SimplyLog…</p></section>';
    if (state.matches("loading")) appEl.innerHTML = '<section class="status-card"><span class="spinner"></span><p>טוענים את פרטי הדיווח…</p></section>';
    if (state.matches("ready")) renderForm(state.context);
    if (state.matches("saving")) appEl.innerHTML = '<section class="status-card"><span class="spinner"></span><p>שולחים את הדיווח…</p></section>';
    if (state.matches("success")) appEl.innerHTML = `<section class="status-card"><div class="result-icon">✓</div><h1 class="result-title">האירוע נשלח בהצלחה</h1><p>תודה על הדיווח.</p>${state.context.result.id ? `<p class="event-number">#${esc(state.context.result.id)}</p>` : ""}<button id="new-event" class="secondary">דיווח נוסף</button></section>`;
    if (state.matches("success")) document.getElementById("new-event").onclick = () => service.send("NEW_EVENT");
    if (state.matches("error")) appEl.innerHTML = `<section class="status-card error"><h1>לא הצלחנו להמשיך</h1><p>${esc(state.context.error)}</p><button id="retry" class="secondary">ניסיון נוסף</button></section>`;
    if (state.matches("error")) document.getElementById("retry").onclick = () => service.send("RETRY");
  });
  service.start();
}());
