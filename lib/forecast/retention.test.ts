import { test } from "node:test";
import assert from "node:assert/strict";
import { selectRunsToDelete } from "./retention";
import type { ForecastRunRow } from "./store";

const NOW = new Date("2027-03-01T03:00:00Z");
const daysAgo = (n: number, hour = 12): string => new Date(NOW.getTime() - n * 86_400_000 + (hour - 3) * 3_600_000).toISOString();
const row = (id: string, model: string, issued_at: string, point: "summit" | "base" = "summit"): ForecastRunRow => ({ id, resort_id: "r", point, model, issued_at, horizon_days: 14 });

test("selectRunsToDelete thins runs older than 7 days to the newest per model per UTC day", () => {
  const rows = [
    row("a", "gfs_seamless", daysAgo(10, 0)),
    row("b", "gfs_seamless", daysAgo(10, 6)),
    row("c", "gfs_seamless", daysAgo(10, 12)),
    row("d", "gfs_seamless", daysAgo(10, 18)), // newest of that day: kept
    row("e", "gfs_seamless", daysAgo(11, 18)), // its own day: kept
    row("f", "ecmwf_ifs025", daysAgo(10, 6)),
    row("g", "ecmwf_ifs025", daysAgo(10, 12)), // kept
  ];
  const recent = new Set(["summit:gfs_seamless", "summit:ecmwf_ifs025"]);
  assert.deepEqual(selectRunsToDelete(rows, recent, NOW).sort(), ["a", "b", "c", "f"]);
});

test("selectRunsToDelete deletes runs older than 120 days but keeps a model's last row when nothing newer exists", () => {
  const rows = [
    row("old1", "gfs_seamless", daysAgo(150, 6)),
    row("old2", "gfs_seamless", daysAgo(150, 18)),
    row("old3", "gfs_seamless", daysAgo(130, 12)),
    row("stale1", "jma_seamless", daysAgo(200, 6)),
    row("stale2", "jma_seamless", daysAgo(190, 6)), // JMA stopped updating: its newest row survives
    row("base1", "gfs_seamless", daysAgo(150, 6), "base"),
  ];
  const recent = new Set(["summit:gfs_seamless"]);
  assert.deepEqual(selectRunsToDelete(rows, recent, NOW).sort(), ["old1", "old2", "old3", "stale1"]);
  assert.deepEqual(selectRunsToDelete([], recent, NOW), []);
});
