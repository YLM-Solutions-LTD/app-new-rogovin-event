(function (root) {
  "use strict";

  const RETRY_STORAGE_KEY = "new-rogovin-event:host-context-retry";
  const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
    "https://mnt.ylm.co.il",
    "https://rogovin.ylm.co.il",
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

  function resolveReferrerOrigin(windowRef, injectedReferrer) {
    const referrer = injectedReferrer !== undefined
      ? injectedReferrer
      : windowRef && windowRef.document && windowRef.document.referrer;
    if (typeof referrer !== "string" || !referrer.trim()) return null;
    try {
      const url = new URL(referrer.trim());
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      return url.origin;
    } catch (_) {
      return null;
    }
  }

  function setDiagnosticStatus(windowRef, status) {
    const documentRef = windowRef && windowRef.document;
    const documentElement = documentRef && documentRef.documentElement;
    if (documentElement && documentElement.dataset) documentElement.dataset.hostContextStatus = status;
  }

  function getSessionStorage(windowRef) {
    try {
      const storage = windowRef && windowRef.sessionStorage;
      if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function" || typeof storage.removeItem !== "function") return null;
      return storage;
    } catch (_) {
      return null;
    }
  }

  function hasRetryFlag(storage) {
    try {
      return Boolean(storage && storage.getItem(RETRY_STORAGE_KEY) === "1");
    } catch (_) {
      return false;
    }
  }

  function setRetryFlag(storage) {
    try {
      storage.setItem(RETRY_STORAGE_KEY, "1");
      return storage.getItem(RETRY_STORAGE_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function clearRetryFlag(storage) {
    try {
      if (storage) storage.removeItem(RETRY_STORAGE_KEY);
    } catch (_) {
      // Storage can be unavailable or restricted; runtime behavior remains safe.
    }
  }

  function createHostContextBridge(options) {
    const config = options || {};
    const windowRef = config.windowRef || root;
    const allowedOrigins = new Set(config.allowedOrigins || DEFAULT_ALLOWED_ORIGINS);
    const expectedReferrerOrigin = resolveReferrerOrigin(windowRef, config.referrer);
    const timeoutMs = Number.isFinite(config.timeoutMs) ? config.timeoutMs : 3000;
    const parentWindow = windowRef.parent;
    const embedded = parentWindow && parentWindow !== windowRef && windowRef.self !== windowRef.top;
    let accepted = null;
    let initialResolved = false;
    let resolveInitial;
    let timeoutId = null;
    const subscribers = new Set();
    const initialPromise = new Promise((resolve) => { resolveInitial = resolve; });
    const sessionStorageRef = getSessionStorage(windowRef);

    setDiagnosticStatus(windowRef, "waiting");

    function settleInitial(value) {
      if (initialResolved) return;
      initialResolved = true;
      if (timeoutId !== null) windowRef.clearTimeout(timeoutId);
      resolveInitial(value);
    }

    function onMessage(event) {
      const originMatches = expectedReferrerOrigin
        ? event && event.origin === expectedReferrerOrigin
        : event && allowedOrigins.has(event.origin);
      if (!embedded || accepted) return;
      if (!event || event.source !== parentWindow || !originMatches) {
        setDiagnosticStatus(windowRef, "origin-rejected");
        return;
      }
      const payload = parseMessage(event.data);
      if (!isValidContext(payload)) {
        setDiagnosticStatus(windowRef, "invalid-context");
        return;
      }

      accepted = { context: payload, origin: event.origin };
      clearRetryFlag(sessionStorageRef);
      setDiagnosticStatus(windowRef, "accepted");
      settleInitial(accepted);
      for (const subscriber of subscribers) subscriber(accepted);
    }

    function handleInitialTimeout() {
      if (initialResolved || accepted) return;
      if (embedded && sessionStorageRef) {
        if (!hasRetryFlag(sessionStorageRef) && setRetryFlag(sessionStorageRef)) {
          setDiagnosticStatus(windowRef, "retrying-parent-load");
          try {
            if (windowRef.location && typeof windowRef.location.reload === "function") {
              windowRef.location.reload();
              settleInitial(null);
              return;
            }
          } catch (_) {
            // Fall through to the normal fallback when the reload is unavailable.
          }
          clearRetryFlag(sessionStorageRef);
        } else {
          clearRetryFlag(sessionStorageRef);
        }
      }
      setDiagnosticStatus(windowRef, "missing-message");
      settleInitial(null);
    }

    windowRef.addEventListener("message", onMessage);
    timeoutId = windowRef.setTimeout(handleInitialTimeout, timeoutMs);

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
    RETRY_STORAGE_KEY,
    DEFAULT_ALLOWED_ORIGINS,
    isValidContext,
    resolveReferrerOrigin,
    createHostContextBridge
  };
}(window));
