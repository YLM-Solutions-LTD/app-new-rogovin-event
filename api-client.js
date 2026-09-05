(function (root) {
  "use strict";

  function createSimplyLogClient(runtime, fetchImpl) {
    const baseUrl = String(runtime && runtime.ApiAddress || "").trim().replace(/\/+$/, "");
    const token = runtime && runtime.Token || {};
    const tokenType = String(token.token_type || "Bearer").trim() || "Bearer";
    const accessToken = typeof token.access_token === "string" ? token.access_token : "";
    const requestFetch = fetchImpl || root.fetch.bind(root);

    async function request(path, options) {
      if (!baseUrl || !accessToken) throw new Error("AUTH_REQUIRED");
      const requestOptions = options || {};
      const headers = Object.assign({}, requestOptions.headers || {}, {
        Authorization: `${tokenType} ${accessToken}`.trim()
      });
      let body = requestOptions.body;
      if (body && typeof body === "object" && !(root.FormData && body instanceof root.FormData)) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(body);
      }

      const response = await requestFetch(`${baseUrl}${path}`, {
        method: requestOptions.method || "GET",
        headers,
        body,
        signal: requestOptions.signal
      });
      if (!response.ok) {
        const error = new Error(`HTTP_${response.status}`);
        error.status = response.status;
        try {
          const responseText = await response.text();
          if (responseText) {
            try { error.body = JSON.parse(responseText); }
            catch (_) { error.body = responseText; }
          }
        } catch (_) { /* Preserve the HTTP status even when the body cannot be read. */ }
        throw error;
      }
      if (response.status === 204) return null;
      const contentType = response.headers && response.headers.get("content-type") || "";
      return contentType.includes("json") ? response.json() : response.text();
    }

    return { request };
  }

  root.NewRogovinEventApi = { createSimplyLogClient };
}(window));
