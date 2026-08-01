# Drop In v2 — competitive run contracts

Only finite, deterministic runs are leaderboard eligible. Free Ride remains an
endless local mode and never produces a competitive submission.

`RunDefinition` is the shared contract in `lib/game/config/modes.ts`:

```ts
interface RunDefinition {
  mode: "time_trial" | "score_attack";
  resortSlug: DropInResortSlug;
  trailId: string;
  seed: number;
  startZ: number;
  finishZ: number;
  durationLimitMs?: number;
  physicsVersion: number;
  courseVersion: number;
}
```

## Mode rules

- `time_trial`: a selected trail, fixed seed/weather, fixed start and finish.
  Lift rides are disabled and restart begins a new session. Rank by elapsed
  `time_ms` ascending, then score descending.
- `score_attack`: a fixed-duration or fixed-vertical session. Rank by score
  descending, then elapsed `time_ms` ascending. Timed definitions must set
  `durationLimitMs` (the initial target is 120,000 ms).

`startZ` and `finishZ` define the authoritative course direction and bounds;
they are not inferred from client position. The server-issued run ticket must
bind the full definition, nonce, expiry, and conditions inputs. Every stored run
also carries its physics and course versions (and, at persistence time, the
asset/config hash), so changed courses do not remain mutually rankable. Old
ghosts may remain viewable.
