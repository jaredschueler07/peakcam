import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileDashboardWidgets } from "../hooks/useDashboard";
import { selectDashboardCams } from "../components/dashboard/DashboardWidget";
import type { Cam, UserFavorite, WidgetConfig } from "./types";

function makeCam(overrides: Partial<Cam> = {}): Cam {
  return {
    id: overrides.id ?? "cam-1",
    resort_id: overrides.resort_id ?? "res-1",
    name: overrides.name ?? "Summit Cam",
    elevation: overrides.elevation ?? "10,000 ft",
    embed_type: overrides.embed_type ?? "image",
    embed_url: overrides.embed_url ?? "https://example.com/cam.jpg",
    youtube_id: overrides.youtube_id ?? null,
    is_active: overrides.is_active ?? true,
    consecutive_failures: overrides.consecutive_failures ?? 0,
    auto_disabled: overrides.auto_disabled ?? false,
    last_checked_at: overrides.last_checked_at ?? null,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

test("reconcileDashboardWidgets preserves saved widget order across reloads", () => {
  const favorites: UserFavorite[] = [
    { id: "f1", user_id: "u1", item_type: "resort", item_id: "taos", created_at: "2026-01-01T00:00:00Z" },
    { id: "f2", user_id: "u1", item_type: "resort", item_id: "silverton", created_at: "2026-01-02T00:00:00Z" },
    { id: "f3", user_id: "u1", item_type: "cam", item_id: "cam-kv", created_at: "2026-01-03T00:00:00Z" },
  ];

  // User moved silverton above taos in List View
  const savedWidgets: WidgetConfig[] = [
    { id: "silverton", type: "resort", x: 0, y: 0, w: 6, h: 4 },
    { id: "cam-kv", type: "cam", x: 6, y: 0, w: 4, h: 3 },
    { id: "taos", type: "resort", x: 0, y: 4, w: 6, h: 4 },
  ];

  const reconciled = reconcileDashboardWidgets(savedWidgets, favorites);
  assert.deepEqual(
    reconciled.map((w) => w.id),
    ["silverton", "cam-kv", "taos"],
  );
  assert.equal(reconciled[0].w, 6);
  assert.equal(reconciled[0].h, 4);
});

test("reconcileDashboardWidgets removes unfavorited items and appends newly favorited items", () => {
  const savedWidgets: WidgetConfig[] = [
    { id: "old-resort", type: "resort", x: 0, y: 0, w: 6, h: 3 },
    { id: "taos", type: "resort", x: 6, y: 0, w: 6, h: 4 },
  ];
  const favorites: UserFavorite[] = [
    { id: "f1", user_id: "u1", item_type: "resort", item_id: "taos", created_at: "2026-01-01T00:00:00Z" },
    { id: "f2", user_id: "u1", item_type: "resort", item_id: "silverton", created_at: "2026-01-02T00:00:00Z" },
  ];

  const reconciled = reconcileDashboardWidgets(savedWidgets, favorites);
  assert.deepEqual(
    reconciled.map((w) => w.id),
    ["taos", "silverton"],
  );
  assert.equal(reconciled[1].w, 4);
  assert.equal(reconciled[1].h, 3);
});

test("selectDashboardCams prioritizes previewable cams before generic iframes and excludes link/disabled cams", () => {
  const genericIframe = makeCam({
    id: "generic-iframe",
    embed_type: "iframe",
    embed_url: "https://unknown-vendor.example.com/player",
  });
  const youtubeCam = makeCam({
    id: "yt-cam",
    embed_type: "youtube",
    embed_url: null,
    youtube_id: "abcdefghijk",
  });
  const imageCam = makeCam({
    id: "img-cam",
    embed_type: "image",
    embed_url: "https://cocam.carsprogram.org/Cellular/550N07065CAM1RHS-N.jpg",
  });
  const disabledCam = makeCam({
    id: "disabled-cam",
    auto_disabled: true,
  });
  const linkCam = makeCam({
    id: "link-cam",
    embed_type: "link",
    embed_url: "https://silvertonmountain.com",
  });

  const selected = selectDashboardCams([
    disabledCam,
    linkCam,
    genericIframe,
    youtubeCam,
    imageCam,
  ]);

  assert.deepEqual(
    selected.map((c) => c.id),
    ["img-cam", "yt-cam", "generic-iframe"],
  );
});

test("selectDashboardCams leaves card_preview=false cams out unless they are all the resort has", () => {
  const editorial = makeCam({ id: "editorial", embed_type: "image", embed_url: "https://example.com/summit.jpg", preview_rank: 1 });
  const flagged = makeCam({ id: "wrong-view", embed_type: "image", embed_url: "https://example.com/parking.jpg", card_preview: false });
  const flaggedIframe = makeCam({ id: "flagged-iframe", embed_type: "iframe", embed_url: "https://unknown-vendor.example.com/player", card_preview: false });

  assert.deepEqual(selectDashboardCams([flagged, editorial, flaggedIframe]).map((c) => c.id), ["editorial"]);
  assert.deepEqual(selectDashboardCams([flagged, flaggedIframe]).map((c) => c.id), ["wrong-view", "flagged-iframe"]);
});
