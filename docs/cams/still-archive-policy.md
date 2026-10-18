# Cam still archive policy

> Status: in force from 2026-10-18 (migration 024, Sprint 8 of the 2026-10-18 execution plan).
> Owner: PeakCam ops. Takedown contact: see "Takedown and opt-out" below.
> Code: `scripts/cam-capture-stills.ts` (writes), `lib/cam-timeline.ts` (rules),
> `lib/supabase.ts` `getCamTimeline()` (reads), `supabase/migrations/024_cam_still_history.sql`.

PeakCam links to and embeds webcams that resorts and their camera providers publish.
Until October 2026 it kept nothing from any of them beyond a single "latest frame" for
the 25 cams whose players expose no still of their own. This document says which cams
PeakCam now keeps a short history for, which it does not, for how long, and how to turn
a cam off.

## 1. What is archived

A cam is archived only when `cams.archive_allowed = true`. The default is **false**; the
column is the single switch, and the public read view (`cam_still_timeline`) joins
through it, so flipping a cam off hides its history from the site at once.

Migration 024 set `archive_allowed = true` once, for cams that fall in one of these
groups. The TypeScript mirror of the rule is `archiveAllowedByDefault()` in
`lib/cam-timeline.ts`; the SQL is the one `UPDATE` at the end of the migration.

| Group | Why it is allowed | Rows flagged 2026-10-18 |
| --- | --- | --- |
| PeakCam-captured (`cams.still_url` set) | PeakCam already captures and stores a frame for these cams every run; the archive only stops throwing the old frames away. | 25 |
| Operator image feeds (`embed_type = 'image'`) | The operator publishes a plain, unauthenticated JPEG URL that refreshes in place. Archiving is a copy of what every visitor's browser already downloads. | 125 |
| Brownrice snapshot (`player.brownrice.com`, `liveN.brownrice.com`, `tsvweather.brownrice.com`) | The player's own `og:image` is a public `/snapshot/<stream>` endpoint. | 91 |
| ipcamlive snapshot (`www.ipcamlive.com`, `gN.ipcamlive.com`) | Public `player/snapshot.php?alias=` next to every player. | 26 |
| Ozolio poster (`relay.ozolio.com`) | Public `pub.api?cmd=poster` the player itself fetches. | 2 |
| **Total** | | **269 of 442 cams (249 active)** |

The run-time predicate, verified against production before the update was applied:

```sql
embed_type <> 'link'
and coalesce(split_part(embed_url,'/',3),'') !~ '(^|\.)(roundshot\.com|windy\.com|opensnow\.com)$'
and (
  still_url is not null
  or embed_type = 'image'
  or (embed_type = 'iframe' and host ~ '^(player|live[0-9]{1,3}|tsvweather)\.brownrice\.com$')
  or (embed_type = 'iframe' and host ~ '^(www|g[0-9]{1,2})\.ipcamlive\.com$')
  or (embed_type = 'iframe' and host = 'relay.ozolio.com')
)
```

## 2. What is linked only (never archived)

| Group | Rows | Reason |
| --- | --- | --- |
| YouTube streams | 124 | Player-only. YouTube's terms do not allow frame capture; the card uses YouTube's own poster, which is fetched live, never stored. |
| Roundshot (any `*.roundshot.com` host, including the two `backend.roundshot.com` image rows) | 15 | Named player-only in the plan's default decision. Roundshot sells its own archive product; PeakCam links. |
| Aggregator re-publishers (`windy.com`, `opensnow.com` image URLs) | 6 | The image URL is a third party's copy, not the operator's endpoint. PeakCam's permission to show it does not extend to re-archiving it. |
| Generic iframes without a PeakCam capture (Verkada, livespotting, timecam, earthcam and others that the capture job cannot read) | 26 | No frame exists to archive. |
| Link-outs (`embed_type = 'link'`) | 21 | Nothing is embedded at all. |

New cams imported from `data/cams.csv` default to `archive_allowed = false`. The
importer does not set the column; run the migration's `UPDATE` again (it is additive)
or flip rows by hand after checking the provider against the table above.

## 3. What a frame is

- One JPEG per cam per run, at most 1280 px wide, quality 4, about 40 KB.
- Captured every 6 h (`com.peakcam.cam-stills.plist`, `StartInterval` 21,600 s),
  aligned with the SNOTEL sync so the 24 h number stamped on the frame is fresh.
- Stored in the public bucket `cam-stills` under `archive/<cam_id>/<iso>.jpg`,
  immutable path, one-year cache headers. The existing "latest frame" objects under
  `<cam_id>/` are untouched and keep their own 7-day retention.
- A row in `cam_stills`: `captured_at`, `path`, capture `source`, dimensions and size,
  blank-frame stats, `snow_24h_at_capture` (the resort's `latest_snow_reports.new_snow_24h`
  at capture time, null when the resort has no report), and `keeper`.
- Blank frames (near-uniform or near-black, the same check the latest-frame job
  uses) are never archived. A dark night is a gap, not a black square.

## 4. Retention

| Frame | Kept | Why |
| --- | --- | --- |
| Non-keeper | 30 days rolling | Enough for "last 24 h" and "same time last week" without an open-ended archive. |
| Keeper (`snow_24h_at_capture >= 6` in.) | 365 days | The "last storm on tape" frame. One season's worth of storm days per cam. |

The capture job prunes at the end of every run: storage object first, then the row.
A frame whose object delete fails keeps its row and is retried next run, so storage
is never orphaned. Rules and thresholds live in `lib/cam-timeline.ts`
(`ARCHIVE_RETENTION_DAYS`, `KEEPER_RETENTION_DAYS`, `KEEPER_MIN_SNOW_24H_IN`).

### Storage estimate

| | |
| --- | --- |
| Archive-allowed active cams | 249 today, planned for about 405 |
| Frames per cam per day | 4 |
| Bytes per frame | about 40 KB |
| Per day at 405 cams | about 65 MB |
| Rolling 30 days | about 2 GB |
| Keepers | about 40 KB × storm-day frames; a 30-storm-day season across 405 cams adds about 2 GB at most |

Current production use before the archive (2026-10-18): 1,170 objects, 106 MB.

## 5. Where it shows

- Resort page: a "Last 24 h" strip of up to four frames for one cam (the page's lead
  cam when it has frames, otherwise the first cam that does), each labelled with the
  capture time and the 24 h number at capture, and a "Last storm on tape" frame when a
  keeper exists. The strip renders nothing when there are no rows.
- Open Graph image: the newest archived frame for the resort is the share-card
  background when one exists.
- Read path: `cam_still_timeline` (public view, `security_invoker`, filtered to
  `archive_allowed and is_active and not auto_disabled`), through `getCamTimeline(camId, hours)`
  in `lib/supabase.ts`. The MCP `get_cam_timeline(slug, camId, hours<=48)` tool
  (Sprint 5's server) should call the same function and `shapeTimeline()` from
  `lib/cam-timeline.ts`; `hours` is clamped to 48 by `clampHours()`.

## 6. Takedown and opt-out

A resort or camera provider that does not want PeakCam to keep frames can use the
"Report this cam" button on any cam tile (it emails the cam-report admin address,
`CAM_REPORT_ADMIN_EMAIL`, see `lib/cam-reports/email.ts`) or write to the contact
address on the About page. PeakCam will:

1. Set `archive_allowed = false` for the cam(s) the same working day. The history
   disappears from the site immediately (view filter) and from the API on its next
   fetch.
2. Delete the archived objects and rows for those cams by hand, without waiting for
   retention:

   ```sql
   -- after setting archive_allowed = false
   select path from cam_stills where cam_id in (...);  -- delete these objects from bucket cam-stills
   delete from cam_stills where cam_id in (...);
   ```

3. Reply confirming the removal.

Written outreach to providers ahead of time is not part of this sprint (plan section
1, item 3); the groups in section 1 were chosen because their endpoints are already
public and already fetched by every visitor's browser.

## 7. How to flip a cam off (or on)

```sql
-- off: history vanishes from the site now; objects are pruned by retention, or by hand as above
update cams set archive_allowed = false where id = '<cam uuid>';

-- on: only for providers in section 1's table
update cams set archive_allowed = true where id = '<cam uuid>';
```

The capture job reads the column on every run; no restart is needed.
