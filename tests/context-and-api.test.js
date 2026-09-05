const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appRoot = path.resolve(__dirname, "..");
const appSource = fs.readFileSync(path.join(appRoot, "app.js"), "utf8");
const hostSource = fs.readFileSync(path.join(appRoot, "host-context.js"), "utf8");
const apiSource = fs.readFileSync(path.join(appRoot, "api-client.js"), "utf8");
const contractSource = fs.readFileSync(path.join(appRoot, "event-contract.js"), "utf8");
const iconSource = fs.readFileSync(path.join(appRoot, "icon-resolver.js"), "utf8");
const uiSource = fs.readFileSync(path.join(appRoot, "ui-helpers.js"), "utf8");
const spriteSource = fs.readFileSync(path.join(appRoot, "icons.svg"), "utf8");
const indexSource = fs.readFileSync(path.join(appRoot, "index.html"), "utf8");
const headersSource = fs.readFileSync(path.join(appRoot, "_headers"), "utf8");
const runtimeSource = `${appSource}\n${contractSource}`;

function makeWindow(embedded, referrer) {
  const listeners = new Map();
  const frame = {};
  const fakeWindow = {
    parent: embedded ? frame : null,
    self: null,
    top: null,
    document: { referrer: referrer || "", documentElement: { dataset: {} } },
    setTimeout,
    clearTimeout,
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener));
    }
  };
  fakeWindow.self = fakeWindow;
  fakeWindow.top = embedded ? {} : fakeWindow;
  if (!embedded) fakeWindow.parent = fakeWindow;
  return {
    window: fakeWindow,
    parent: frame,
    dispatch(event) {
      for (const listener of listeners.get("message") || []) listener(event);
    }
  };
}

function makeSessionStorage(initialValue) {
  const values = new Map();
  if (initialValue !== undefined) values.set(initialValue.key, initialValue.value);
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); }
  };
}

function loadScript(source, fakeWindow, extraGlobals) {
  vm.runInNewContext(source, Object.assign({ window: fakeWindow, URL, setTimeout, clearTimeout }, extraGlobals));
}

function validContext() {
  return {
    ApiAddress: "https://api.example.test///",
    Token: { token_type: "Bearer", access_token: "test-access-token" },
    LanguageCode: "he",
    Location: { Id: 42, Type: "2", TypeName: "Building", FullName: "בניין מרכזי" },
    Reporter: { Id: 7, FullName: "תושב בדיקה" }
  };
}

test("nested host location exits fallback, loads categories, and is displayed and submitted", async () => {
  const fixture = makeWindow(true);
  const calls = [];
  fixture.window.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => [{ Id: 9, Name: "תקלה", Icon: "⚠️" }]
    };
  };
  loadScript(hostSource, fixture.window);
  loadScript(apiSource, fixture.window);
  loadScript(contractSource, fixture.window);
  const host = fixture.window.NewRogovinEventHost;
  const api = fixture.window.NewRogovinEventApi.createSimplyLogClient(validContext());
  const contract = fixture.window.NewRogovinEventContract;
  const bridge = host.createHostContextBridge({
    windowRef: fixture.window,
    allowedOrigins: ["https://host.example.test"],
    timeoutMs: 10
  });

  assert.equal(await bridge.waitForInitialContext(), null);
  let display = "תצוגה מקדימה";
  let payload = null;
  const done = new Promise((resolve, reject) => {
    bridge.subscribe(async (record) => {
      try {
        const location = contract.normalizeContextLocation(record.context);
        const categories = await api.request("/api/Categories/All");
        payload = contract.buildCreateNewEventInfo(record.context, location, {
          categoryId: categories[0].Id,
          description: "דיווח בדיקה",
          startTime: "2026-09-05T00:00:00.000Z"
        });
        display = location.name;
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });

  fixture.dispatch({ source: fixture.parent, origin: "https://host.example.test", data: JSON.stringify(validContext()) });
  await done;

  assert.notEqual(display, "תצוגה מקדימה");
  assert.equal(display, "בניין מרכזי");
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), {
    CategoryId: 9,
    LocationId: 42,
    LocationType: "Building",
    Description: "דיווח בדיקה",
    StartTime: "2026-09-05T00:00:00.000Z",
    ReporterId: 7,
    ReporterName: "תושב בדיקה"
  });
  assert.deepEqual(calls.map((call) => call.url), ["https://api.example.test/api/Categories/All"]);
});

test("a valid context received before state-machine initialization is retained", async () => {
  const fixture = makeWindow(true);
  loadScript(hostSource, fixture.window);
  const bridge = fixture.window.NewRogovinEventHost.createHostContextBridge({
    windowRef: fixture.window,
    allowedOrigins: ["https://host.example.test"],
    timeoutMs: 50
  });

  fixture.dispatch({ source: fixture.parent, origin: "https://host.example.test", data: validContext() });
  const record = await bridge.waitForInitialContext();
  assert.equal(record.context.Location.Id, 42);
  assert.equal(bridge.getAcceptedContext(), record);
});

test("standalone mode reaches fallback without accepting self-posted context", async () => {
  const fixture = makeWindow(false);
  loadScript(hostSource, fixture.window);
  const bridge = fixture.window.NewRogovinEventHost.createHostContextBridge({
    windowRef: fixture.window,
    allowedOrigins: ["https://host.example.test"],
    timeoutMs: 10
  });
  const received = [];
  bridge.subscribe((record) => received.push(record));
  fixture.dispatch({ source: fixture.window, origin: "https://host.example.test", data: validContext() });

  assert.equal(await bridge.waitForInitialContext(), null);
  assert.deepEqual(received, []);
});

test("invalid origin, source, and payload shape are ignored", async () => {
  const fixture = makeWindow(true);
  loadScript(hostSource, fixture.window);
  const bridge = fixture.window.NewRogovinEventHost.createHostContextBridge({
    windowRef: fixture.window,
    allowedOrigins: ["https://host.example.test"],
    timeoutMs: 10
  });
  const received = [];
  bridge.subscribe((record) => received.push(record));

  fixture.dispatch({ source: fixture.parent, origin: "https://evil.example.test", data: validContext() });
  fixture.dispatch({ source: {}, origin: "https://host.example.test", data: validContext() });
  fixture.dispatch({ source: fixture.parent, origin: "https://host.example.test", data: JSON.stringify({ ApiAddress: "https://api.example.test", Token: {} }) });

  assert.equal(await bridge.waitForInitialContext(), null);
  assert.deepEqual(received, []);
});

test("Rogovin referrer authorizes the exact parent origin", async () => {
  const fixture = makeWindow(true, "https://rogovin.ylm.co.il/index.html#/App/new-event");
  loadScript(hostSource, fixture.window);
  const bridge = fixture.window.NewRogovinEventHost.createHostContextBridge({
    windowRef: fixture.window,
    timeoutMs: 10
  });

  fixture.dispatch({ source: fixture.parent, origin: "https://rogovin.ylm.co.il", data: validContext() });

  const record = await bridge.waitForInitialContext();
  assert.equal(record.origin, "https://rogovin.ylm.co.il");
  assert.equal(record.context.Token.access_token, "test-access-token");
});

test("a mismatched origin is rejected when a valid referrer origin exists", async () => {
  const fixture = makeWindow(true, "https://rogovin.ylm.co.il/index.html#/App/new-event");
  loadScript(hostSource, fixture.window);
  const bridge = fixture.window.NewRogovinEventHost.createHostContextBridge({ timeoutMs: 10 });

  fixture.dispatch({ source: fixture.parent, origin: "https://mnt.ylm.co.il", data: validContext() });

  assert.equal(await bridge.waitForInitialContext(), null);
  assert.equal(bridge.getAcceptedContext(), null);
});

test("malformed referrer falls back to the fixed known-origin allowlist", async () => {
  const fixture = makeWindow(true, "not a valid referrer");
  loadScript(hostSource, fixture.window);
  const bridge = fixture.window.NewRogovinEventHost.createHostContextBridge({ timeoutMs: 10 });

  fixture.dispatch({ source: fixture.parent, origin: "https://rogovin.ylm.co.il", data: validContext() });

  const record = await bridge.waitForInitialContext();
  assert.equal(record.origin, "https://rogovin.ylm.co.il");
});

test("known-origin allowlist is used when no referrer is available", async () => {
  const fixture = makeWindow(true);
  loadScript(hostSource, fixture.window);
  const bridge = fixture.window.NewRogovinEventHost.createHostContextBridge({ timeoutMs: 10 });

  fixture.dispatch({ source: fixture.parent, origin: "https://rogovin.ylm.co.il", data: validContext() });

  const record = await bridge.waitForInitialContext();
  assert.equal(record.origin, "https://rogovin.ylm.co.il");
});

test("first embedded timeout reloads exactly once and records the retry status", async () => {
  const fixture = makeWindow(true);
  let reloads = 0;
  fixture.window.sessionStorage = makeSessionStorage();
  fixture.window.location = { reload() { reloads += 1; } };
  loadScript(hostSource, fixture.window);
  const host = fixture.window.NewRogovinEventHost;
  const bridge = host.createHostContextBridge({ windowRef: fixture.window, timeoutMs: 5 });

  assert.equal(await bridge.waitForInitialContext(), null);
  assert.equal(reloads, 1);
  assert.equal(fixture.window.document.documentElement.dataset.hostContextStatus, "retrying-parent-load");
  assert.equal(fixture.window.sessionStorage.getItem(host.RETRY_STORAGE_KEY), "1");
});

test("second embedded timeout does not reload and settles to the fallback", async () => {
  const fixture = makeWindow(true);
  let reloads = 0;
  const hostStorage = makeSessionStorage({ key: "new-rogovin-event:host-context-retry", value: "1" });
  fixture.window.sessionStorage = hostStorage;
  fixture.window.location = { reload() { reloads += 1; } };
  loadScript(hostSource, fixture.window);
  const host = fixture.window.NewRogovinEventHost;
  const bridge = host.createHostContextBridge({ windowRef: fixture.window, timeoutMs: 5 });

  assert.equal(await bridge.waitForInitialContext(), null);
  assert.equal(reloads, 0);
  assert.equal(hostStorage.getItem(host.RETRY_STORAGE_KEY), null);
  assert.equal(fixture.window.document.documentElement.dataset.hostContextStatus, "missing-message");
});

test("accepted context clears the retry flag and records the accepted status", async () => {
  const fixture = makeWindow(true, "https://rogovin.ylm.co.il/index.html#/App/new-event");
  const hostStorage = makeSessionStorage({ key: "new-rogovin-event:host-context-retry", value: "1" });
  fixture.window.sessionStorage = hostStorage;
  loadScript(hostSource, fixture.window);
  const host = fixture.window.NewRogovinEventHost;
  const bridge = host.createHostContextBridge({ windowRef: fixture.window, timeoutMs: 10 });

  fixture.dispatch({ source: fixture.parent, origin: "https://rogovin.ylm.co.il", data: validContext() });

  assert.ok(await bridge.waitForInitialContext());
  assert.equal(hostStorage.getItem(host.RETRY_STORAGE_KEY), null);
  assert.equal(fixture.window.document.documentElement.dataset.hostContextStatus, "accepted");
});

test("location type falls back to a converted Type when TypeName is absent", () => {
  const fakeWindow = {};
  loadScript(contractSource, fakeWindow);
  const location = fakeWindow.NewRogovinEventContract.normalizeContextLocation({
    Location: { Id: "43", Type: "3", Name: "בניין משני" }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(location)), { id: 43, name: "בניין משני", type: "Cell", mine: true });
  const info = fakeWindow.NewRogovinEventContract.buildCreateNewEventInfo({
    Location: { Id: "43", Type: "3", Name: "בניין משני" },
    Name: "משתמש שורש",
    Email: "root@example.test"
  }, location, { categoryId: 9, description: "דיווח", startTime: "2026-09-05T00:00:00.000Z" });
  assert.equal(info.LocationType, "Cell");
  assert.equal(info.ReporterName, "משתמש שורש");
  assert.equal(info.ReporterEmail, "root@example.test");
});

test("multipart contract uses one async request with JSON metadata and numbered attachments", () => {
  class FakeFormData {
    constructor() { this.parts = []; }
    append(name, value, filename) { this.parts.push({ name, value, filename }); }
  }
  const fakeWindow = { FormData: FakeFormData };
  loadScript(contractSource, fakeWindow);
  const payload = { LocationId: 42 };
  const form = fakeWindow.NewRogovinEventContract.createAttachmentsForm(payload, [
    { name: "one.jpg" },
    { name: "two.pdf" }
  ]);

  assert.equal(form.parts.length, 3);
  assert.equal(form.parts[0].name, "createNewEvent");
  assert.equal(form.parts[0].value, JSON.stringify(payload));
  assert.equal(form.parts[0].filename, undefined);
  assert.deepEqual(form.parts.slice(1).map((part) => [part.name, part.filename]), [["attachment1", "one.jpg"], ["attachment2", "two.pdf"]]);
});

test("API client trims ApiAddress, defaults auth scheme, and sends the exact route without a multipart boundary", async () => {
  const calls = [];
  class FakeFormData {}
  const fakeWindow = {
    FormData: FakeFormData,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ Id: 101 })
      };
    }
  };
  loadScript(apiSource, fakeWindow);
  const api = fakeWindow.NewRogovinEventApi.createSimplyLogClient({
    ApiAddress: "https://api.example.test///",
    Token: { access_token: "test-access-token" }
  });
  const multipart = new FakeFormData();
  await api.request("/api/Events/CreateWithAttachments", {
    method: "POST",
    headers: { "X-SimplyLog-Async": "true" },
    body: multipart
  });

  assert.equal(calls[0].url, "https://api.example.test/api/Events/CreateWithAttachments");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-access-token");
  assert.equal(calls[0].options.headers["X-SimplyLog-Async"], "true");
  assert.equal(calls[0].options.headers["Content-Type"], undefined);
});

test("event creation without files posts JSON CreateNewEventInfo to /api/Events", async () => {
  const calls = [];
  const fakeWindow = {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => ({ Id: 102 })
      };
    }
  };
  loadScript(apiSource, fakeWindow);
  const api = fakeWindow.NewRogovinEventApi.createSimplyLogClient({
    ApiAddress: "https://api.example.test/",
    Token: { token_type: "Bearer", access_token: "test-access-token" }
  });
  await api.request("/api/Events", {
    method: "POST",
    body: { CategoryId: 9, LocationId: 42, LocationType: "Building", Description: "דיווח", StartTime: "2026-09-05T00:00:00.000Z" }
  });

  assert.equal(calls[0].url, "https://api.example.test/api/Events");
  assert.equal(calls[0].options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    CategoryId: 9,
    LocationId: 42,
    LocationType: "Building",
    Description: "דיווח",
    StartTime: "2026-09-05T00:00:00.000Z"
  });
});

test("saveEvent without files requests the compact numeric 201 result", async () => {
  const calls = [];
  const fakeWindow = {
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        headers: { get: () => "application/json" },
        json: async () => 103
      };
    }
  };
  loadScript(apiSource, fakeWindow);
  loadScript(contractSource, fakeWindow);
  const api = fakeWindow.NewRogovinEventApi.createSimplyLogClient({
    ApiAddress: "https://api.example.test/",
    Token: { access_token: "test-access-token" }
  });
  const result = await fakeWindow.NewRogovinEventContract.saveEvent(api, validContext(), {
    location: { id: 42, type: "Building", name: "בניין מרכזי" },
    categoryId: 9,
    description: "דיווח",
    files: []
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { id: 103 });
  assert.equal(calls[0].url, "https://api.example.test/api/Events");
  assert.equal(calls[0].options.headers["X-SimplyLog-Async"], "true");
});

test("API errors preserve the response body without putting credentials in the message", async () => {
  const fakeWindow = {
    fetch: async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify(["Missing category"])
    })
  };
  loadScript(apiSource, fakeWindow);
  const api = fakeWindow.NewRogovinEventApi.createSimplyLogClient({
    ApiAddress: "https://api.example.test/",
    Token: { access_token: "secret-test-token" }
  });

  await assert.rejects(api.request("/api/Events", { method: "POST", body: {} }), (error) => {
    assert.equal(error.status, 400);
    assert.deepEqual(JSON.parse(JSON.stringify(error.body)), ["Missing category"]);
    assert.doesNotMatch(error.message, /secret-test-token/);
    return true;
  });
});

test("CreateWithAttachments accepts a bare numeric HTTP 201 response and returns the event result", async () => {
  class FakeFormData {
    constructor() { this.parts = []; }
    append(name, value, filename) { this.parts.push({ name, value, filename }); }
  }
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options.type; }
  }
  const calls = [];
  const fakeWindow = {
    FormData: FakeFormData,
    Blob: FakeBlob,
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 201,
        headers: { get: () => "application/json" },
        json: async () => 734
      };
    }
  };
  loadScript(apiSource, fakeWindow);
  loadScript(contractSource, fakeWindow);
  const api = fakeWindow.NewRogovinEventApi.createSimplyLogClient({
    ApiAddress: "https://api.example.test///",
    Token: { token_type: "Bearer", access_token: "test-access-token" }
  });
  const result = await fakeWindow.NewRogovinEventContract.saveEvent(api, validContext(), {
    location: { id: 42, type: "Building", name: "בניין מרכזי" },
    categoryId: 9,
    description: "דיווח עם תמונה",
    startTime: "2026-09-05T00:00:00.000Z",
    files: [{ name: "photo.jpg" }]
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), { id: 734 });
  assert.equal(calls[0].url, "https://api.example.test/api/Events/CreateWithAttachments");
  assert.equal(calls[0].options.headers["X-SimplyLog-Async"], "true");
  assert.equal(calls[0].options.body.parts[0].name, "createNewEvent");
  assert.equal(calls[0].options.body.parts[1].name, "attachment1");
});

test("event ID normalization accepts positive numbers, numeric strings, and object response shapes", () => {
  const fakeWindow = {};
  loadScript(contractSource, fakeWindow);
  const normalize = fakeWindow.NewRogovinEventContract.normalizeEventId;
  assert.equal(normalize(734), 734);
  assert.equal(normalize("734"), 734);
  assert.equal(normalize({ Id: "735" }), 735);
  assert.equal(normalize({ eventId: 736 }), 736);
  assert.equal(normalize(0), null);
  assert.equal(normalize("not-an-id"), null);
});

test("compact option grids reserve the last box for the overflow button", () => {
  const fakeWindow = {};
  loadScript(uiSource, fakeWindow);
  const items = Array.from({ length: 30 }, (_, index) => ({ id: index + 1, name: `Item ${index + 1}` }));
  const locations = fakeWindow.NewRogovinEventUi.compactOptions(items, 10, 22);
  const categories = fakeWindow.NewRogovinEventUi.compactOptions(items, 25, null);

  assert.equal(locations.items.length, 9);
  assert.equal(locations.items.at(-1).id, 22);
  assert.equal(locations.hasMore, true);
  assert.equal(categories.items.length, 24);
  assert.equal(categories.hasMore, true);
  assert.deepEqual(JSON.parse(JSON.stringify(fakeWindow.NewRogovinEventUi.filterOptions(items, "Item 29"))).map((item) => item.id), [29]);
});

test("Font Awesome shortcuts use the local SVG sprite and SVG URLs stay image-only", () => {
  const fakeWindow = { location: { href: "https://app.example.test/" } };
  loadScript(iconSource, fakeWindow);
  const icons = fakeWindow.NewRogovinEventIcons;

  assert.equal(icons.faName("fa fa-wrench"), "fa-wrench");
  assert.match(icons.renderIcon("fa fa-wrench", (value) => value), /icons\.svg\?v=5#fa-wrench/);
  assert.equal(icons.safeSvgUrl("https://cdn.example.test/icon.svg"), "https://cdn.example.test/icon.svg");
  assert.equal(icons.safeSvgUrl("javascript:alert(1)"), "");
  ["fa-wrench", "fa-plug", "fa-tint", "fa-snowflake-o", "fa-trash", "fa-angle-double-up", "fa-bicycle", "fa-car", "fa-id-card"].forEach((name) => {
    assert.match(spriteSource, new RegExp(`id=\\"${name}\\"`));
  });
});

test("the category dataset is limited to records with a configured Icon", () => {
  assert.match(appSource, /normalizeList\(categoryData, "category"\)\.filter\(\(category\) => String\(category\.icon/);
});

test("only source-backed routes are present in the app", () => {
  assert.match(runtimeSource, /\/api\/Categories\/All/);
  assert.match(runtimeSource, /\/api\/Locations\/All/);
  assert.match(runtimeSource, /\/api\/Events["']/);
  assert.match(runtimeSource, /\/api\/Events\/CreateWithAttachments/);
  const obsoleteRoutes = [
    '"/api/' + ["Event", "Categories"].join("") + '"',
    '"/api/' + ["Locations", "My"].join("/") + '"',
    '"/api/' + ["Events", "Create"].join("/") + '"',
    '"/api/' + ["Attachments", "Event"].join("/") + '"'
  ];
  obsoleteRoutes.forEach((route) => assert.equal(runtimeSource.includes(route), false, `obsolete route found: ${route}`));
  assert.doesNotMatch(runtimeSource, /od["']?ata/i);
});

test("local assets are versioned and Cloudflare serves them without caching", () => {
  ["app.css", "host-context.js", "api-client.js", "event-contract.js", "icon-resolver.js", "ui-helpers.js", "app.js"].forEach((asset) => {
    const escapedAsset = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(indexSource, new RegExp(`(?:src|href)=\\"\\./${escapedAsset}\\?v=5\\"`), `unversioned local asset: ${asset}`);
  });

  const noCache = "Cache-Control: no-store, no-cache, must-revalidate, max-age=0";
  const headerBlocks = headersSource.split(/\r?\n\s*\r?\n/).map((block) => block.trim());
  ["/", "/*.html", "/*.js", "/*.css", "/*.svg"].forEach((pattern) => {
    const block = headerBlocks.find((candidate) => candidate.startsWith(`${pattern}\n`) || candidate.startsWith(`${pattern}\r\n`));
    assert.ok(block, `missing _headers coverage for ${pattern}`);
    assert.match(block, new RegExp(noCache.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });
});
