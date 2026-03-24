# PeakCam — Webcam Health Monitoring Architecture

## Current State (March 23, 2026)
- 301 cams across 128 resorts
- 204/239 tested working (85.4%)
- HDRelay is the #1 failure point (17+ broken cams, possibly all 39 due to missing headers)
- BrownRice is the most reliable provider (100% uptime)

## Check Frequency

| Check Type | Frequency | Target |
|-----------|-----------|--------|
| Quick health check (HTTP status) | Every 6 hours | All cams |
| Staleness check (Last-Modified / Content-Length) | Every 12 hours | Image cams only |
| YouTube stream validation (oEmbed) | Every 6 hours | YouTube cams |
| Auto-discovery scrape | Weekly (Sunday night) | Resorts with dead cams |
| Deep validation (image hash) | Daily | Flagged stale cams |

## Check Logic Per Embed Type

### YouTube
- oEmbed API: `youtube.com/oembed?url=...&format=json`
- 200 = healthy, 401 = embedding disabled, 404 = deleted
- On failure: scrape resort cam page for new stream IDs

### iframe (BrownRice, IPCamLive, Roundshot, etc.)
- GET request with proper User-Agent
- BrownRice: slug-based URLs never change — most stable provider

### image (HDRelay, self-hosted JPEGs)
- HEAD with User-Agent + Referer headers (critical for HDRelay!)
- Check HTTP status AND Content-Length > 0
- Track Last-Modified for staleness detection
- If Last-Modified > 48h and Content-Length unchanged × 4 checks → stale

### link
- HEAD request, accept 200/301/302/307/308
- No staleness checking needed

## Alert Thresholds

| Condition | Action |
|-----------|--------|
| 1 failure | Record, do nothing |
| 3 consecutive (18h) | health_status = 'degraded' |
| 6 consecutive (36h) | health_status = 'dead', trigger auto-discovery, Slack alert |
| All cams for a provider fail | Flag as provider outage, don't mark individual cams dead |
| Auto-discovery finds new URL | health_status = 'pending_review', Slack alert |

## Provider Reliability Ranking
1. BrownRice (100%) — slug-based, never rotates
2. IPCamLive (100%) — alias-based, stable
3. Roundshot (100%) — subdomain-based, stable
4. YouTube (85%) — stream IDs expire when recreated
5. HDRelay (unknown — 500s may be header issue, not actual failures)
6. Self-hosted JPEG (variable) — depends on resort IT
