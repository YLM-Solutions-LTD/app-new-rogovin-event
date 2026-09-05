(function (root) {
  "use strict";

  const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
    "https://mnt.ylm.co.il",
    "https://simplylog.ylm.co.il",
    "https://app.simplylog.co.il",
    "https://www.simplylog.co.il",
    "https://simplylog.co.il"
  ]);

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function parseMessage(data) {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch (_) {
        return null;
      }
    }
    return data;
  }

  function isValidContext(payload) {
    if (!isRecord(payload) || typeof payload.ApiAddress !== "string" || !payload.ApiAddress.trim()) return false;
    if (!isRecord(payload.Token) || typeof payload.Token.access_token !== "string" || !payload.Token.access_token.trim()) return false;
    if (payload.Token.token_type !== undefined && (typeof payload.Token.token_type !== "string" || !payload.Token.token_type.trim())) return false;

    try {
      const url = new URL(payload.ApiAddress.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    } catch (_) {
      return false;
    }

    return true;
  }

  function createHostContextBridge(options) {
    const config = options || {};
    const windowRef = config.windowRef || root;
    const allowedOrigins = new Set(config.allowedOrigins || DEFAULT_ALLOWED_ORIGINS);
    const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 3000;
    const parentWindow = windowRef.parent;
    const embedded = parentWindow && parentWindow !== windowRef && windowRef.self !== windowRef.top;
    let accepted = null;
    let initialResolved = false;
    let resolveInitial;
    let timeoutId = null;
    const subscribers = new Set();
    const initialPromise = new Promise((resolve) => { resolveInitial = resolve; });

    function settleInitial(value) {
      if (initialResolved) return;
      initialResolved = true;
      if (timeoutId !== null) windowRef.clearTimeout(timeoutId);
      resolveInitial(value);
    }

    function onMessage(event) {
      if (!embedded || accepted || !event || event.source !== parentWindow || !allowedOrigins.has(event.origin)) return;
      const payload = parseMessage(event.data);
      if (!isValidContext(payload)) return;

      accepted = { context: payload, origin: event.origin };
      settleInitial(accepted);
      for (const subscriber of subscribers) subscriber(accepted);
    }

    windowRef.addEventListener("message", onMessage);
    timeoutId = windowRef.setTimeout(() => settleInitial(null), timeoutMs);

    return {
      waitForInitialContext() {
        return initialPromise;
      },
      subscribe(listener) {
        if (typeof listener !== "function") return () => {};
        subscribers.add(listener);
        if (accepted) listener(accepted);
        return () => subscribers.delete(listener);
      },
      getAcceptedContext() {
        return accepted;
      },
      destroy() {
        windowRef.removeEventListener("message", onMessage);
        if (timeoutId !== null) windowRef.clearTimeout(timeoutId);
        subscribers.clear();
      }
    };
  }

  root.NewRogovinEventHost = {
    DEFAULT_ALLOWED_ORIGINS,
    isValidContext,
    createHostContextBridge
  };
}(window));
