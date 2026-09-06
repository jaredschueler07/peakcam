# Provider camera previews

`roundshot.json` records thumbnail URLs declared in `twitter:image` on the
existing active camera player pages, retrieved 2026-09-05. Keys are source
player URLs; values are provider-hosted thumbnails. Images stay on the provider
and keep their original content/branding. No images are stored here.

Brownrice's public player metadata explicitly publishes
`https://player.brownrice.com/snapshot/<stream>` as `og:image`; the resolver uses
that pattern only for the exact `player.brownrice.com/embed/<stream>` host/path.
Verified against https://player.brownrice.com/embed/vailch21 (snapshot HTTP 200).
Roundshot example: https://aspen.roundshot.com/aspen/ declares
https://aspen.roundshot.com/cams/91/thumbnail.

These are previews, not proof of a live stream or recent camera capture. No
capture timestamps are inferred from successful HTTP loads or health checks.
Unknown providers and failed images fall back to the camera action/count.
Refresh mappings with `node scripts/discover-camera-previews.mjs` using the
existing public Supabase environment; this reads records and player HTML only.
