# new-rogovin-event

Static SimplyLog hosted mini-app for resident event reporting.

## Host configuration

Add the hosted URL under `Security.AuthorizedApps`:

```json
{"Type":"String","Group":"Security","Name":"AuthorizedApps","Value":"{\"new-rogovin-event\":{\"Url\":\"https://new-rogovin-event.app.simplylog.co.il\"}}"}
```

The app uses only the host-provided `ApiAddress` and `Token`; credentials must not be placed in Connections. The runtime endpoints and request contracts are:

- `GET /api/Categories/All` for categories.
- `GET /api/Locations/All` only when the host context does not contain a usable `Location`.
- `POST /api/Events` with JSON `CreateNewEventInfo` when no files are selected.
- `POST /api/Events/CreateWithAttachments` as one multipart request when files are selected. It sends `X-SimplyLog-Async: true`, a JSON `createNewEvent` part with `application/json`, and file parts named `attachment1`, `attachment2`, and so on. The browser supplies the multipart boundary.
- The async attachment endpoint may return HTTP 201 with a bare numeric JSON event ID; numeric strings and the existing `Id`/`id`/`EventId`/`eventId` object shapes are normalized as well.

`CreateNewEventInfo` includes `CategoryId`, `LocationId`, `LocationType`, `Description`, `StartTime`, and reporter fields when present in the host context. The current location is normalized from `context.Location.Id`, `context.Location.FullName`/`Name`, and `context.Location.TypeName` or its converted `Type` value. Flattened location fields remain compatibility fallbacks.

The guest listens for the documented SimplyLog message envelope (`JSON.stringify(context)` or its object equivalent), requires an exact approved origin and the parent window as the sender, and validates `ApiAddress` plus `Token.access_token` before leaving bootstrap. It keeps listening after the standalone preview timeout, so a late valid context immediately starts the authenticated state. A context received before XState starts is retained by the bridge.

Opening `index.html` outside SimplyLog shows the branded Hebrew/RTL preview and makes no API requests. Live locations, categories, attachments, and submission are enabled only with a valid host context.

Run the deterministic regression suite with:

```bash
npm test
```
