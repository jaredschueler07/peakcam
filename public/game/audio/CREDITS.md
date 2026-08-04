# Drop In v2 — audio credits

Every sound shipped in this directory is **CC0 1.0 Universal (public domain
dedication)**. No file here carries an attribution obligation, so nothing in the
shipped page has to render a credit. This file exists so the provenance stays
auditable, not because any licence demands it.

All ten masters come from **The Designer's Choice UCS Collection** by
**Nicholas A. Judy** (The Designer's Choice), self-published to the Internet
Archive in August 2025 under CC0 1.0.

- Licence: <https://creativecommons.org/publicdomain/zero/1.0/>
- Uploader: the recordist himself, `NicholasJudy456@gmail.com`
- Collection description: *"All sound effects are available to you on a complete
  royalty-free basis. Use these in many personal and commercial projects. You can
  credit me or not."*

The `licenseurl` field on each archive.org item was checked programmatically and
is CC0 1.0 for every item listed below. Items in the same collection that carried
**no** licence field (`FOOTSTEPS`, `FOLEY`, `FOOD & DRINK`) were deliberately
skipped.

## Files

| Shipped layer | archive.org item | Path within the item |
|---|---|---|
| `wind-bed` | [`Designers-Choice-Collection-Wind`](https://archive.org/details/Designers-Choice-Collection-Wind) | `WIND/TURBULENT/WINDTurb-CU_Blizzard, Old Recording_Nicholas Judy_TDC.wav` |
| `wind-gust` | [`Designers-Choice-Collection-Wind`](https://archive.org/details/Designers-Choice-Collection-Wind) | `WIND/DESIGNED/WINDDsgn-Blue Snowball Microphone, CU_Gusts, Acme Windmaster_Nicholas Judy_TDC.wav` |
| `carve-packed` | [`Designers-Choice-Collection-Swooshes`](https://archive.org/details/Designers-Choice-Collection-Swooshes) | `SWOOSHES/SWISH/SWSH-Blue Snowball Microphone, CU_Swishes, Simulated Using Nails On Plastic Tray 03_Nicholas Judy_TDC.wav` |
| `carve-powder` | [`Designers-Choice-Collection-Air`](https://archive.org/details/Designers-Choice-Collection-Air) | `AIR/HISS/AIRHiss-Blue Snowball Microphone, CU_Steady, Human Imitation, Looped_Nicholas Judy_TDC.wav` |
| `lift-hum` | [`Designers-Choice-Collection-Machines`](https://archive.org/details/Designers-Choice-Collection-Machines) | `MACHINES/ESCALATOR/MACHEscl-Samsung Galaxy Smartphone, CU_Escalator, Running, Looped_Nicholas Judy_TDC.wav` |
| `jump-whoosh` | [`Designers-Choice-Collection-Swooshes`](https://archive.org/details/Designers-Choice-Collection-Swooshes) | `SWOOSHES/WHOOSH/WHSH-CU_Fly By, Short_The Designer's Choice_GNRL3.wav` |
| `land-soft` | [`Designers-Choice-Collection-Fight`](https://archive.org/details/Designers-Choice-Collection-Fight) | `FIGHT/BODYFALL/FGHTBf-Samsung Galaxy Smartphone, CU_Bodyfall, Snow_Nicholas Judy_TDC.wav` |
| `crash-impact` | [`Designers-Choice-Collection-Fight`](https://archive.org/details/Designers-Choice-Collection-Fight) | `FIGHT/BODYFALL/FGHTBf-Samsung Galaxy Smartphone, CU_Bodyfall, On Grass_Nicholas Judy_TDC.wav` |
| `ui-tick` | [`Designers-Choice-Collection-Games`](https://archive.org/details/Designers-Choice-Collection-Games) | `GAMES/BOARD/GAMEBoard-Samsung Galaxy Smartphone, MCU_Chess, Piece, Place Onto Board, Single_Nicholas Judy_TDC.wav` |
| `trick-chime` | [`Designers-Choice-Collection-Bells`](https://archive.org/details/Designers-Choice-Collection-Bells) | `BELLS/MISC/BELLMisc-Blue Snowball Microphone, CU_Meditation Chime, Ring_Nicholas Judy_TDC.wav` |

Download URL for any row:
`https://archive.org/download/<item>/<percent-encoded path>`.

## Substitutions worth knowing about

Three layers are not literally the thing they represent, because no CC0 recording
of the real thing was reachable. They were chosen for texture, and the procedural
bed (`ProceduralSoundBank`) is what actually carries the physical reactivity:

- **`carve-packed`** is fingernails drawn across a plastic tray — a bright,
  granular friction that reads as an edge biting hardpack. The collection's SNOW
  item holds exactly one sound (a snowball impact), and its FOOTSTEPS sibling has
  no licence field, so neither could be used.
- **`lift-hum`** is a running escalator, which is the same slow gearbox-and-cable
  drone as a chairlift heard from below.
- **`crash-impact`** is a body falling on grass — a drier, heavier thud than
  `land-soft`'s body-on-snow, which is what makes the pair read as soft landing
  versus wipeout.

## Sources that were tried and did not work

- **Freesound** — the search API returns `401` without a token, and downloads
  require a logged-in session. No token was available in this environment.
- **Pixabay** and **Sonniss** — both return `403` to a non-browser client.
- **Wikimedia Commons** — reachable, but its wind and snow field recordings are
  overwhelmingly CC BY-SA, which would put an attribution obligation in the page.
- **OpenGameArt** (CC0 filter) — reachable, but thin: no snow, no chime, no
  machinery hum.

## Rebuilding

`scripts/build-audio-samples.sh <dir-with-master-wavs>` regenerates every `.ogg`/`.m4a`
here from the masters. The masters themselves are ~30 MB of WAV (some at 192 kHz)
and are deliberately not committed; re-download them from the table above.
Processing decisions are documented in `docs/drop-in-v2/AUDIO.md` §5.
