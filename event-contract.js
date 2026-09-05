(function (root) {
  "use strict";

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  const LOCATION_TYPES = ["SiteGeoGroup", "Site", "Building", "Cell"];

  function normalizeId(value) {
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    return value;
  }

  function normalizeLocationType(value) {
    if (isRecord(value)) {
      const explicit = normalizeLocationType(value.TypeName ?? value.typeName ?? value.EntityName ?? value.entityName ?? value.EntityType ?? value.entityType ?? value.Type ?? value.type);
      return explicit || normalizeLocationTypeFromPath(value.Path ?? value.path ?? value.EntityNamePath ?? value.entityNamePath);
    }
    if (value == null) return "";
    const normalized = String(value).trim();
    if (/^\d+$/.test(normalized)) return LOCATION_TYPES[Number(normalized)] || "";
    const known = LOCATION_TYPES.find((item) => item.toLowerCase() === normalized.toLowerCase());
    return known || normalized;
  }

  function normalizeLocationTypeFromPath(value) {
    const path = String(value || "").trim();
    if (!path) return "";
    const leaf = path.split("/").filter(Boolean).at(-1) || "";
    const type = leaf.split(",").at(-1) || "";
    return normalizeLocationType(type);
  }

  function normalizeContextLocation(context) {
    const runtime = isRecord(context) ? context : {};
    const source = isRecord(runtime.Location) ? runtime.Location : {};
    const id = normalizeId(source.Id ?? source.id ?? runtime.LocationId ?? runtime.LocationEntityId ?? runtime.CurrentLocationId);
    const type = normalizeLocationType(source) || normalizeLocationType(runtime.LocationType ?? runtime.LocationTypeId);
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
    multipart.append("createNewEvent", JSON.stringify(payload));
    (Array.isArray(files) ? files : []).forEach((file, index) => multipart.append(`attachment${index + 1}`, file, file.name));
    return multipart;
  }

  async function saveEvent(api, context, form) {
    const values = form || {};
    const payload = buildCreateNewEventInfo(context, values.location, values);
    let result;
    if (!Array.isArray(values.files) || !values.files.length) {
      result = await api.request("/api/Events", {
        method: "POST",
        headers: { "X-SimplyLog-Async": "true" },
        body: payload
      });
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

  root.NewRogovinEventContract = { LOCATION_TYPES, normalizeContextLocation, normalizeLocationType, normalizeLocationTypeFromPath, buildCreateNewEventInfo, normalizeEventId, createAttachmentsForm, saveEvent };
}(window));
