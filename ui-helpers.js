(function (root) {
  "use strict";

  function compactOptions(items, limit, selectedId, getKey) {
    const values = Array.isArray(items) ? items : [];
    const maximum = Math.max(1, Number(limit) || 1);
    const keyOf = typeof getKey === "function" ? getKey : (item) => item && item.id;
    if (values.length <= maximum) return { items: values.slice(), hasMore: false };

    const visible = values.slice(0, maximum - 1);
    const selected = values.find((item) => String(keyOf(item)) === String(selectedId));
    if (selected && !visible.some((item) => String(keyOf(item)) === String(keyOf(selected)))) {
      visible[visible.length - 1] = selected;
    }
    return { items: visible, hasMore: true };
  }

  function filterOptions(items, query) {
    const normalized = String(query || "").trim().toLocaleLowerCase();
    if (!normalized) return (Array.isArray(items) ? items : []).slice();
    return (Array.isArray(items) ? items : []).filter((item) => String(item.name || "").toLocaleLowerCase().includes(normalized));
  }

  root.NewRogovinEventUi = { compactOptions, filterOptions };
}(window));
