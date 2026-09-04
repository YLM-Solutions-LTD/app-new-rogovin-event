# new-rogovin-event

Static SimplyLog hosted mini-app for resident event reporting.

## Host configuration

Add the hosted URL under `Security.AuthorizedApps`:

```json
{"Type":"String","Group":"Security","Name":"AuthorizedApps","Value":"{\"new-rogovin-event\":{\"Url\":\"https://new-rogovin-event.app.simplylog.co.il\"}}"}
```

Optional public app configuration can be supplied as a `Connections` entry named `new-rogovin-event.app`. All values are exposed to the browser:

```json
{"categoriesEndpoint":"/odata/EventCategory?$filter=Icon%20ne%20null","createEndpoint":"/api/Events/Create","attachmentEndpoint":"/api/tenant-attachment-endpoint/{eventId}","attachmentField":"file"}
```

The category endpoint defaults to the SimplyLog EventCategory OData API and only categories with an icon are shown. The first location tile comes from the host context (`LocationEntityId` and `LocationFullName`); any `Locations` or `AssignedLocations` values follow it. The app uses the host-provided `ApiAddress` and `Token`; never put credentials in Connections.

Opening `index.html` outside SimplyLog shows the complete form in a safe preview mode. Live locations, categories, attachments, and submission are enabled only with valid host context.
