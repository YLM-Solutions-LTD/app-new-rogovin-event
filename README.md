# new-rogovin-event

Static SimplyLog hosted mini-app for resident event reporting.

## Host configuration

Add the hosted URL under `Security.AuthorizedApps`:

```json
{"Type":"String","Group":"Security","Name":"AuthorizedApps","Value":"{\"new-rogovin-event\":{\"Url\":\"https://new-rogovin-event.app.simplylog.co.il\"}}"}
```

Optional public app configuration can be supplied as a `Connections` entry named `new-rogovin-event.app`. All values are exposed to the browser:

```json
{"locationsEndpoint":"/api/tenant-location-endpoint","categoriesEndpoint":"/api/tenant-category-endpoint","createEndpoint":"/api/Events/Create","attachmentEndpoint":"/api/tenant-attachment-endpoint/{eventId}","attachmentField":"file"}
```

If list endpoints are not supplied, `locations` and `categories` arrays may be provided directly. Category entries require `id`, `name`, and `icon`. The app uses the host-provided `ApiAddress` and `Token`; never put credentials in Connections.

Opening `index.html` outside SimplyLog shows a non-submitting preview after a short timeout.
