(function (root) {
  "use strict";

  const SPRITE_MAP = Object.freeze({
    "fa-wrench": "fa-wrench",
    "fa-plug": "fa-plug",
    "fa-tint": "fa-tint",
    "fa-snowflake-o": "fa-snowflake-o",
    "fa-trash": "fa-trash",
    "fa-angle-double-up": "fa-angle-double-up",
    "fa-bicycle": "fa-bicycle",
    "fa-car": "fa-car",
    "fa-id-card": "fa-id-card"
  });

  const ALLOWED_SVG_TAGS = new Set(["svg", "g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon", "title", "desc"]);
  const ALLOWED_SVG_ATTRIBUTES = new Set([
    "xmlns", "viewBox", "width", "height", "fill", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "transform", "d", "cx", "cy", "r", "rx", "ry",
    "x", "y", "x1", "y1", "x2", "y2", "points", "role", "aria-label", "aria-hidden", "focusable"
  ]);

  function faName(value) {
    return String(value || "").trim().split(/\s+/).find((item) => /^fa-[a-z0-9-]+$/i.test(item)) || "";
  }

  function safeSvgUrl(value) {
    const input = String(value || "").trim();
    if (!input || /^<svg[\s>]/i.test(input)) return "";
    try {
      const parsed = new URL(input, root.location && root.location.href || "https://invalid.local/");
      if (!/^https?:$/.test(parsed.protocol)) return "";
      if (!/\.svg(?:$|[?#])/i.test(parsed.pathname + parsed.search + parsed.hash)) return "";
      return parsed.href;
    } catch (_) {
      return "";
    }
  }

  function sanitizeInlineSvg(value) {
    const input = String(value || "").trim();
    if (!/^<svg[\s>]/i.test(input) || !root.DOMParser || !root.XMLSerializer) return "";
    const document = new root.DOMParser().parseFromString(input, "image/svg+xml");
    const svg = document.documentElement;
    if (!svg || svg.localName !== "svg" || document.querySelector("parsererror")) return "";

    Array.from(svg.querySelectorAll("*")).forEach((element) => {
      if (!ALLOWED_SVG_TAGS.has(element.localName)) {
        element.remove();
        return;
      }
      Array.from(element.attributes).forEach((attribute) => {
        if (!ALLOWED_SVG_ATTRIBUTES.has(attribute.name) || /^on/i.test(attribute.name) || /url\s*\(|javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
      });
    });
    Array.from(svg.attributes).forEach((attribute) => {
      if (!ALLOWED_SVG_ATTRIBUTES.has(attribute.name) || /^on/i.test(attribute.name) || /url\s*\(|javascript:/i.test(attribute.value)) svg.removeAttribute(attribute.name);
    });
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    return new root.XMLSerializer().serializeToString(svg);
  }

  function renderIcon(value, escapeHtml) {
    const input = String(value || "").trim();
    const mapped = SPRITE_MAP[faName(input)];
    if (mapped) return `<svg class="category-svg" aria-hidden="true" focusable="false"><use href="./icons.svg?v=5#${mapped}"></use></svg>`;

    const url = safeSvgUrl(input);
    if (url) return `<img class="category-svg" src="${escapeHtml(url)}" alt="">`;

    const inlineSvg = sanitizeInlineSvg(input);
    return inlineSvg ? `<span class="inline-svg">${inlineSvg}</span>` : '<svg class="category-svg" aria-hidden="true" focusable="false"><use href="./icons.svg?v=5#fa-generic"></use></svg>';
  }

  root.NewRogovinEventIcons = { SPRITE_MAP, faName, safeSvgUrl, sanitizeInlineSvg, renderIcon };
}(window));
