(function () {
  "use strict";

  const APP_NAME = "new-rogovin-event";
  const RTL_LANGS = ["he", "ar", "fa", "ur"];
  const appEl = document.getElementById("app");
  const hostBridge = window.NewRogovinEventHost.createHostContextBridge();
  const initialHostContext = hostBridge.waitForInitialContext();

  if (!window.XState || !window.NewRogovinEventApi || !window.NewRogovinEventContract) {
    appEl.innerHTML = '<section class="status-card"><h1>לא ניתן לפתוח את הטופס</h1><p>יש לבדוק את החיבור לרשת ולנסות שוב.</p></section>';
    return;
  }

  const { createMachine, assign, interpret } = XState;
  const { createSimplyLogClient } = window.NewRogovinEventApi;
  const { normalizeContextLocation, normalizeLocationType, saveEvent: saveEventRequest } = window.NewRogovinEventContract;

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
      if (typeof value === "string") {
        try { value = JSON.parse(value); } catch (_) { /* Keep public scalar configuration as-is. */ }
      }
      result[key] = value;
    }
    return result;
  }

  function listFrom(data) {
    if (Array.isArray(data)) return data;
    return data && (data.Items || data.items || data.Value || data.value || data.Results || data.results || data.Categories || data.categories || data.Locations || data.locations) || [];
  }

  function normalizeList(data, kind) {
    return listFrom(data).map((item) => ({
      id: item && (item.Id ?? item.id ?? item.CategoryId ?? item.categoryId ?? item.LocationId ?? item.locationId ?? item.EntityId ?? item.entityId ?? item.Value ?? item.value),
      name: item && (item.Name || item.name || item.CategoryName || item.categoryName || item.LocationName || item.locationName || item.Title || item.title || item.FullName || item.fullName || item.LocationFullName),
      icon: item && (item.Icon || item.icon || item.IconName || item.iconName || item.IconClass || item.iconClass || ""),
      type: item && (typeof item.TypeName === "string" && item.TypeName.trim() ? item.TypeName.trim() : normalizeLocationType(item.Type ?? item.type))
    })).filter((item) => item.id != null && item.name);
  }

  function runtimeLocations(runtime) {
    const mine = normalizeContextLocation(runtime);
    const supplied = normalizeList(runtime.Locations || runtime.AssignedLocations || [], "location")
      .filter((item) => !mine || String(item.id) !== String(mine.id));
    return (mine ? [mine] : []).concat(supplied);
  }

  function authenticatedData(record) {
    const context = record.context;
    const language = resolveLanguage(context);
    const connections = parseAppConnections(context.Configuration);
    const runtime = Object.assign({}, context, { connections, language });
    return {
      runtime,
      api: createSimplyLogClient(runtime),
      standalone: false,
      pendingContext: null,
      acceptedOrigin: record.origin,
      error: ""
    };
  }

  function errorMessage(error) {
    if (error && (error.status === 401 || error.message === "AUTH_REQUIRED" || error.message === "MISSING_SESSION")) {
      return "פג תוקף החיבור. יש לרענן את עמוד SimplyLog ולהתחבר מחדש.";
    }
    if (error && error.status === 403) return "אין לך הרשאה לבצע את הפעולה. יש לפנות למנהל המערכת.";
    if (error && error.message === "NO_CATEGORIES") return "אין כרגע קטגוריות זמינות לדיווח.";
    return "לא הצלחנו להשלים את הפעולה. אפשר לנסות שוב.";
  }

  const machine = createMachine({
    id: "newEvent",
    initial: "bootstrapping",
    context: {
      runtime: null,
      api: null,
      standalone: false,
      pendingContext: null,
      acceptedOrigin: "",
      locations: [],
      categories: [],
      result: null,
      error: ""
    },
    states: {
      bootstrapping: {
        invoke: {
          src: "bootstrap",
          onDone: [
            { target: "landing", cond: (_, event) => event.data.standalone, actions: assign((_, event) => event.data) },
            { target: "loading", actions: assign((_, event) => event.data) }
          ],
          onError: { target: "error", actions: assign({ error: (_, event) => errorMessage(event.data) }) }
        }
      },
      landing: {
        on: {
          HOST_CONTEXT_RECEIVED: {
            target: "authenticating",
            actions: assign({
              pendingContext: (_, event) => event.context,
              acceptedOrigin: (_, event) => event.origin,
              standalone: () => false,
              error: () => ""
            })
          }
        }
      },
      authenticating: {
        invoke: {
          src: "bootstrapFromPendingContext",
          onDone: { target: "loading", actions: assign((_, event) => event.data) },
          onError: { target: "error", actions: assign({ error: (_, event) => errorMessage(event.data) }) }
        }
      },
      loading: {
        invoke: {
          src: "loadOptions",
          onDone: { target: "ready", actions: assign((_, event) => event.data) },
          onError: { target: "error", actions: assign({ error: (_, event) => errorMessage(event.data) }) }
        },
        on: { HOST_CONTEXT_RECEIVED: { actions: () => {} } }
      },
      ready: {
        on: { SUBMIT: "saving" }
      },
      saving: {
        invoke: {
          src: "saveEvent",
          onDone: { target: "success", actions: assign({ result: (_, event) => event.data }) },
          onError: { target: "error", actions: assign({ error: (_, event) => errorMessage(event.data) }) }
        }
      },
      success: {
        on: { NEW_EVENT: { target: "ready", actions: assign({ result: null, error: "" }) } }
      },
      error: {
        on: {
          RETRY: "loading",
          HOST_CONTEXT_RECEIVED: {
            target: "authenticating",
            actions: assign({
              pendingContext: (_, event) => event.context,
              acceptedOrigin: (_, event) => event.origin,
              standalone: () => false,
              error: () => ""
            })
          }
        }
      }
    }
  }, {
    services: {
      bootstrap: async () => {
        const record = await initialHostContext;
        return record ? authenticatedData(record) : { standalone: true, error: "" };
      },
      bootstrapFromPendingContext: (context) => authenticatedData({
        context: context.pendingContext,
        origin: context.acceptedOrigin
      }),
      loadOptions: async (context) => {
        const categoryData = await context.api.request("/api/Categories/All");
        let locations = runtimeLocations(context.runtime);
        if (!locations.length) locations = normalizeList(await context.api.request("/api/Locations/All"), "location");
        const categories = normalizeList(categoryData, "category");
        if (!categories.length) throw new Error("NO_CATEGORIES");
        return { locations, categories, error: "" };
      },
      saveEvent: async (context, event) => {
        return saveEventRequest(context.api, context.runtime, event.form);
      }
    }
  });

  function esc(value) {
    const div = document.createElement("div");
    div.textContent = String(value ?? "");
    return div.innerHTML;
  }

  function renderForm(context, options) {
    const preview = Boolean(options && options.preview);
    const locations = Array.isArray(context.locations) ? context.locations : [];
    const categories = Array.isArray(context.categories) ? context.categories : [];
    const previewNotice = preview ? '<div class="preview-notice" role="status"><strong>תצוגה מקדימה</strong><span>כדי לטעון את המיקום והקטגוריות ולשלוח דיווח, יש לפתוח את היישום מתוך SimplyLog.</span></div>' : "";
    const locationsMarkup = locations.length
      ? locations.map((location, index) => `<button class="location${index === 0 ? " selected" : ""}" type="button" data-id="${esc(location.id)}" aria-pressed="${index === 0}"${preview ? " disabled" : ""}><span class="location-pin" aria-hidden="true">⌖</span><span>${esc(location.name)}</span>${location.mine ? '<small>המיקום שלי</small>' : ""}</button>`).join("")
      : '<p class="empty-options">המיקום שלי יוצג לאחר פתיחת היישום מתוך SimplyLog.</p>';
    const categoriesMarkup = categories.length
      ? categories.map((category) => `<button class="category" type="button" data-id="${esc(category.id)}" aria-pressed="false"${preview ? " disabled" : ""}><span class="check">✓</span><span class="icon" aria-hidden="true">${esc(category.icon)}</span><span>${esc(category.name)}</span></button>`).join("")
      : '<p class="empty-options">הקטגוריות יוצגו כאן מתוך SimplyLog.</p>';

    appEl.innerHTML = `<div class="shell"><section class="panel">${previewNotice}<ol class="progress" aria-label="תהליך הדיווח"><li class="active"><span>1</span></li><li><span>2</span></li><li><span>3</span></li><li><span>4</span></li></ol><header><h1>דיווח על אירוע חדש</h1><p>בחרו את סוג האירוע, הוסיפו פרטים ושלחו.</p></header><form id="event-form" novalidate><fieldset class="field plain-fieldset"><legend class="legend">מיקום האירוע</legend><div class="locations">${locationsMarkup}</div></fieldset><fieldset class="field plain-fieldset"><legend class="legend">סוג האירוע <span class="required">*</span></legend><div class="categories">${categoriesMarkup}</div></fieldset><div class="field"><label for="description">תיאור האירוע <span class="required">*</span></label><textarea id="description" maxlength="1000" placeholder="פרטו מה קרה, היכן ומתי"${preview ? " disabled" : ""}></textarea></div><div class="field"><label class="dropzone">⌁ <strong>צרפו קבצים או תמונות</strong><br><span class="hint">עד 10MB לקובץ</span><input id="attachments" type="file" multiple accept="image/*,.pdf"${preview ? " disabled" : ""}></label><ul id="file-list" class="files"></ul></div><p id="validation" class="validation" role="alert"></p><button class="submit" type="submit"${preview ? " disabled" : ""}>שליחת הדיווח</button></form></section></div>`;
    if (preview) return;

    let selectedCategory = "";
    const locationsById = new Map(locations.map((location) => [String(location.id), location]));
    let selectedLocation = locations[0] || null;
    appEl.querySelectorAll(".location").forEach((button) => button.addEventListener("click", () => {
      selectedLocation = locationsById.get(button.dataset.id) || null;
      appEl.querySelectorAll(".location").forEach((item) => {
        const active = item === button;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-pressed", String(active));
      });
    }));
    appEl.querySelectorAll(".category").forEach((button) => button.addEventListener("click", () => {
      selectedCategory = button.dataset.id;
      appEl.querySelectorAll(".category").forEach((item) => {
        const active = item === button;
        item.classList.toggle("selected", active);
        item.setAttribute("aria-pressed", String(active));
      });
    }));
    const fileInput = document.getElementById("attachments");
    fileInput.addEventListener("change", () => {
      document.getElementById("file-list").innerHTML = Array.from(fileInput.files).map((file) => `<li>${esc(file.name)} · ${Math.ceil(file.size / 1024)}KB</li>`).join("");
    });
    document.getElementById("event-form").addEventListener("submit", (event) => {
      event.preventDefault();
      const description = document.getElementById("description").value.trim();
      const files = Array.from(fileInput.files);
      const validation = document.getElementById("validation");
      if (!selectedCategory || !description) {
        validation.textContent = "יש לבחור סוג אירוע ולמלא תיאור.";
        return;
      }
      if (files.some((file) => file.size > 10 * 1024 * 1024)) {
        validation.textContent = "אחד הקבצים גדול מ‑10MB.";
        return;
      }
      service.send({ type: "SUBMIT", form: { location: selectedLocation, categoryId: selectedCategory, description, files } });
    });
  }

  let service;
  service = interpret(machine).onTransition((state) => {
    if (!state.changed && !state.matches("bootstrapping")) return;
    if (state.matches("bootstrapping") || state.matches("authenticating")) appEl.innerHTML = '<section class="status-card"><span class="spinner"></span><p>מתחברים ל‑SimplyLog…</p></section>';
    if (state.matches("landing")) renderForm({ locations: [], categories: [] }, { preview: true });
    if (state.matches("loading")) appEl.innerHTML = '<section class="status-card"><span class="spinner"></span><p>טוענים את פרטי הדיווח…</p></section>';
    if (state.matches("ready")) renderForm(state.context);
    if (state.matches("saving")) appEl.innerHTML = '<section class="status-card"><span class="spinner"></span><p>שולחים את הדיווח…</p></section>';
    if (state.matches("success")) {
      appEl.innerHTML = `<section class="status-card"><div class="result-icon">✓</div><h1 class="result-title">האירוע נשלח בהצלחה</h1><p>תודה על הדיווח.</p>${state.context.result.id ? `<p class="event-number">#${esc(state.context.result.id)}</p>` : ""}<button id="new-event" class="secondary">דיווח נוסף</button></section>`;
      document.getElementById("new-event").onclick = () => service.send("NEW_EVENT");
    }
    if (state.matches("error")) {
      appEl.innerHTML = `<section class="status-card error"><h1>לא הצלחנו להמשיך</h1><p>${esc(state.context.error)}</p><button id="retry" class="secondary">ניסיון נוסף</button></section>`;
      document.getElementById("retry").onclick = () => service.send("RETRY");
    }
  });
  service.start();

  hostBridge.subscribe((record) => {
    service.send({ type: "HOST_CONTEXT_RECEIVED", context: record.context, origin: record.origin });
  });
}());
