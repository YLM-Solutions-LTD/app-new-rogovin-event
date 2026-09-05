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
const runtimeSource = `${appSource}\n${contractSource}`;

function makeWindow(embedded) {
  const listeners = new Map();
  const frame = {};
  const fakeWindow = {
    parent: embedded ? frame : null,
    self: null,
    top: null,
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

test("location type falls back to a converted Type when TypeName is absent", () => {
  const fakeWindow = {};
  loadScript(contractSource, fakeWindow);
  const location = fakeWindow.NewRogovinEventContract.normalizeContextLocation({
    Location: { Id: "43", Type: "3", Name: "בניין משני" }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(location)), { id: 43, name: "בניין משני", type: "3", mine: true });
  const info = fakeWindow.NewRogovinEventContract.buildCreateNewEventInfo({
    Location: { Id: "43", Type: "3", Name: "בניין משני" },
    Name: "משתמש שורש",
    Email: "root@example.test"
  }, location, { categoryId: 9, description: "דיווח", startTime: "2026-09-05T00:00:00.000Z" });
  assert.equal(info.LocationType, "3");
  assert.equal(info.ReporterName, "משתמש שורש");
  assert.equal(info.ReporterEmail, "root@example.test");
});

test("multipart contract uses one async request with JSON metadata and numbered attachments", () => {
  class FakeFormData {
    constructor() { this.parts = []; }
    append(name, value, filename) { this.parts.push({ name, value, filename }); }
  }
  class FakeBlob {
    constructor(parts, options) { this.parts = parts; this.type = options.type; }
  }
  const fakeWindow = { FormData: FakeFormData, Blob: FakeBlob };
  loadScript(contractSource, fakeWindow);
  const payload = { LocationId: 42 };
  const form = fakeWindow.NewRogovinEventContract.createAttachmentsForm(payload, [
    { name: "one.jpg" },
    { name: "two.pdf" }
  ]);

  assert.equal(form.parts.length, 3);
  assert.equal(form.parts[0].name, "createNewEvent");
  assert.equal(form.parts[0].value.type, "application/json");
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
