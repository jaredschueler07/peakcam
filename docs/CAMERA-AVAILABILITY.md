# Camera availability and recovery

Embedded players are hosted by third parties. Loading an iframe is not proof that its video is playing, and browser cross-origin isolation prevents PeakCam from reading arbitrary player errors.

Every embedded video player exposes **Camera not playing?**, followed by **Retry camera** and a link to the resort's camera page when configured. A manually opened recovery view is not an assertion that the upstream feed is down. Retrying reloads the player, even if a cached availability check still says it was down; it does not modify camera records or automatically send a report.

Brownrice players additionally use `/api/cams/{id}/status`. The endpoint looks up an active camera ID, parses the provider's embed and script metadata as text (never executing it), and checks the HLS playlist plus one rendition playlist. Camera names, HTTPS provider hostnames, allowed ports and rendition paths are constrained; redirects and arbitrary caller URLs are refused. Response bodies and the overall provider request time are bounded. Checks are cached for 60 seconds to limit upstream traffic.

An explicit unavailable playlist response (404, 410 or server error) replaces the player with **Camera unavailable** and recovery controls. Authentication blocks, timeouts, changed provider markup and inconclusive responses yield **unknown** and leave the player accessible. A responding playlist does not certify browser playback or video freshness. **Stream checked** is labeled separately from capture time; PeakCam does not invent a last-capture timestamp. Other providers retain manual recovery without claiming automatic playback monitoring.

Vail Back Bowl (`player.brownrice.com/embed/vailch21`) was responding during the September 7, 2026 implementation check. Its earlier failure was upstream; this change makes subsequent failures recoverable and visible. The scheduled legacy camera-health job remains separate: it checks wrapper URLs and is not a substitute for the on-demand playlist check.

Tests in `lib/next-fixes.test.ts` exercise healthy/down/unknown responses, changed markup, oversized bodies and hostile URLs. Browser verification covers resort tiles, expanded previews and recovery controls at mobile and desktop sizes.
