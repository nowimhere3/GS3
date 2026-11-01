# Gallery capability host contract (S5A)

This is discovery only. There are no favorite commands, request IDs, shortcuts
or toolbar controls. A cooperative child must implement the reply below in a
separately authorized Browser Gallery change; GS3 never identifies it by URL.

Both messages use source: "gs3-capability-bridge", version: 1,
capability: "GALLERY_FAVORITE".

- Host: type: "QUERY_CAPABILITY", generation: opaque string.
- Child: type: "CAPABILITY_PRESENT", generation: exact echoed string,
  features: array of feature-name strings.

The host queries after every settled iframe load. Assignment and every load
rotate the generation; pending multi-load assignments keep the gate closed
until the canonical navigation pending-load count reaches zero. Reports before
the gate opens, without the echoed generation, or from old generations fail.
Children should reply to queries rather than relying on startup announcements.

Features are bounded to 32 entries, each 1–64 ASCII alphanumeric characters
starting with a letter. Names are case sensitive. Sets are deduplicated and
sorted. Expected names include favoriteCurrent, keyForward, nativeHeartFeedback
and mediaChanged. Valid future names may be retained, but no feature is acted on.
An empty feature array still explicitly advertises the capability.

Trust requires both actual event.source correlation through the shared
findPanelForSourceWindow function and an exact allowed event.origin:
GS3's own nonopaque origin, https://nowimhere3.github.io, or HTTP localhost /
127.0.0.1 (any port, for local development). Origin policy limits who may
advertise; it does not infer capability. Discovery queries use targetOrigin "*"
and carry only the protocol discriminator and ephemeral generation. No action
or content is sent. Fill's protocol and trust rules are unchanged.

## Consumer API

js/gallery-favorite-bridge.js exports:

- getGalleryFavoriteCapability(panel): detached snapshot with generation,
  acceptingReports, capable and features; null if unregistered.
- isGalleryFavoriteCapable(panel): boolean for a connected Panel.
- GALLERY_CAPABILITY_CHANGED: bubbling Panel event
  "gs3:gallery-favorite-capability-changed". Read the snapshot on notification.

Notifications occur on first presence, feature-set changes and loss/reset of
previously present capability. Identical reordered/duplicate reports and resets
of an already unknown Panel do not notify. Removed Panels notify before removal.
Registration, reset/query and unregister functions are lifecycle hooks used by
launch.js and Grid replacement cleanup, not a second Runtime state owner.

Snapshots are never serialized. There is no dependency on assigned URL,
observedCurrentUrl, a userscript, Position, Layer targeting or Gallery DOM.
