# Opt-in browser QA hook

Append `?e2edebug=1` (or `&e2edebug=1`) before starting the game. No `window.__dropInDebug` is constructed for missing/empty/0/true flags. Runtime disposal removes its own hook without deleting a newer runtime's hook.

```js
const d = window.__dropInDebug;
d.snapshot();
d.setQuality(4); // pins entire ladder and resets percentile sample history
d.setQuality(1);
d.setQuality(4);
d.setQuality(null); // release pin to normal thermal governor
```

Snapshot gives copied pose/velocity/yaw/time, lift index/progress/distance, course progress/selection/finish, airborne/crash state, ranked/paused/debug-mutated flags, backend, p50/p95 frame timing/rung/DPR, serializable renderer render/memory counters, and indexed real run/lift catalogs with actual station coordinates. It exposes no renderer, scene, core state or mutable terrain references. Renderer information depends on the backend's available counter fields. Percentile collection remains actual RAF frame timing, not proof of GPU execution duration.

Free Ride only:

```js
d.selectRun(1);       // normal fresh reset on the indexed actual run
d.spawnAtLift(0);     // complete genuine lift base; core boards on the next tick
d.stepTicks(120);     // pause real-time simulation; advance 1 simulated second
d.stepTicks(1200, { steer: 0.3, tuck: 0.8, brake: 0, jumpHeld: false });
d.resume();          // resume normal RAF simulation
```

`stepTicks` accepts1..12000 fixed ticks per call and quantizes steer/tuck/brake exactly like input tape. It renders the resulting pose once with no synthetic percentile sample. It does not play accelerated audio or publish recording events. The RAF callback remains registered but paused and cannot advance simulation concurrently. Use small step counts near unload so subsequent skiing does not obscure the endpoint. `spawnAtLift` rejects incomplete/clipped lifts and does not force a lift index; normal proximity logic chooses/boards the lift. Overlapping authentic stations can therefore select the first eligible lift, just as in normal play.

All state-changing methods reject competitive sessions. Snapshots and render-quality control remain available there. Any Free Ride mutation permanently rejects later `beginCompetitiveRecording`; start a new session to record. A debug-accelerated ride verifies the sampled ride/render path only; it does not certify real elapsed ride time, natural player navigation, device input or performance. Never report accelerated time as measured wall time.

Validation: four hook/runtime tests cover strict flag gate, lifecycle replacement cleanup, competitive mutation rejection, snapshot copy isolation, bounded fixed clock, recording exclusion, and genuine base/normal boarding. Existing creation/thermal tests are run alongside them. No core module imports DOM or debug code.
