(function (root) {
  "use strict";

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeId(value) {
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    return value;
  }

  function normalizeLocationType(value) {
    if (isRecord(value)) {
      return normalizeLocationType(value.Value ?? value.value ?? value.Id ?? value.id ?? value.Name ?? value.name);
    }
    return value == null ? "" : String(value).trim();
  }

  function normalizeContextLocation(context) {
    const runtime = isRecord(context) ? context : {};
    const source = isRecord(runtime.Location) ? runtime.Location : {};
    const id = normalizeId(source.Id ?? source.id ?? runtime.LocationId ?? runtime.LocationEntityId ?? runtime.CurrentLocationId);
    const hasTypeName = typeof source.TypeName === "string" && source.TypeName.trim() !== "";
    const type = hasTypeName
      ? source.TypeName.trim()
      : normalizeLocationType(source.Type ?? source.type ?? runtime.LocationType ?? runtime.LocationTypeId);
    const name = source.FullName || source.fullName || source.Name || source.name || runtime.LocationFullName || runtime.LocationName || runtime.CurrentLocationName || "המיקום שלי";
    if (id == null) return null;
    return { id, name, type, mine: true };
  }

  function firstDefined(values) {
    return values.find((value) => value !== undefined && value !== null && value !== "");
  }

  function addIfPresent(target, key, value) {
    if (value !== undefined && value !== null && value !== "") target[key] = value;
  }

  function buildCreateNewEventInfo(context, location, form) {
    const runtime = isRecord(context) ? context : {};
    const selectedLocation = location || normalizeContextLocation(runtime) || {};
    const values = form || {};
    const reporter = runtime.Reporter || runtime.CurrentUser || runtime.User || {};
    const info = {
      CategoryId: normalizeId(values.categoryId),
      LocationId: normalizeId(selectedLocation.id),
      LocationType: selectedLocation.type,
      Description: String(values.description || "").trim(),
      StartTime: values.startTime || new Date().toISOString()
    };

    addIfPresent(info, "ReporterId", firstDefined([runtime.ReporterId, reporter.ReporterId, reporter.Id, reporter.id]));
    addIfPresent(info, "ReporterName", firstDefined([runtime.ReporterName, reporter.ReporterName, reporter.FullName, reporter.fullName, reporter.Name, reporter.name, runtime.Name]));
    addIfPresent(info, "ReporterPhone", firstDefined([runtime.ReporterPhone, reporter.ReporterPhone, reporter.Phone, reporter.phone]));
    addIfPresent(info, "ReporterEmail", firstDefined([runtime.ReporterEmail, reporter.ReporterEmail, reporter.Email, reporter.email, runtime.Email]));
    return info;
  }

  function normalizeEventId(result) {
    const value = isRecord(result) ? (result.Id ?? result.id ?? result.EventId ?? result.eventId) : result;
    const numeric = typeof value === "string" ? Number(value.trim()) : value;
    return typeof numeric === "number" && Number.isFinite(numeric) && numeric > 0 ? numeric : null;
  }

  function createAttachmentsForm(payload, files) {
    const multipart = new root.FormData();
    multipart.append("createNewEvent", new root.Blob([JSON.stringify(payload)], { type: "application/json" }));
    (Array.isArray(files) ? files : []).forEach((file, index) => multipart.append(`attachment${index + 1}`, file, file.name));
    return multipart;
  }

  async function saveEvent(api, context, form) {
    const values = form || {};
    const payload = buildCreateNewEventInfo(context, values.location, values);
    let result;
    if (!Array.isArray(values.files) || !values.files.length) {
      result = await api.request("/api/Events", { method: "POST", body: payload });
    } else {
      result = await api.request("/api/Events/CreateWithAttachments", {
        method: "POST",
        headers: { "X-SimplyLog-Async": "true" },
        body: createAttachmentsForm(payload, values.files)
      });
    }
    const eventId = normalizeEventId(result);
    if (eventId === null) throw new Error("INVALID_CREATE_RESPONSE");
    return { id: eventId };
  }

  root.NewRogovinEventContract = { normalizeContextLocation, normalizeLocationType, buildCreateNewEventInfo, normalizeEventId, createAttachmentsForm, saveEvent };
}(window));
