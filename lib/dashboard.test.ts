import { test } from "node:test";
import assert from "node:assert/strict";
import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { executeDashboardSync, isSignedOutAuthError, reconcileDashboardWidgets, type DashboardSyncStore } from "../hooks/useDashboard";
import {
  clampRglLayout,
  colsForViewportWidth,
  mergeBreakpointLayoutChange,
  reconcileEditExitLayout,
  widgetLayoutsEqual,
} from "./dashboard-layout";
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

test("a missing or rejected session is signed out, not a load error", () => {
  // What supabase.auth.getUser() returns for a visitor who is not signed in.
  assert.equal(isSignedOutAuthError(new AuthSessionMissingError()), true);
  assert.equal(isSignedOutAuthError(new AuthApiError("invalid JWT", 403, "bad_jwt")), true);
  assert.equal(isSignedOutAuthError(new AuthApiError("upstream", 503, undefined)), false);
  assert.equal(isSignedOutAuthError(new AuthRetryableFetchError("Failed to fetch", 0)), false);
  assert.equal(isSignedOutAuthError(null), false);
});

test("executeDashboardSync aborts without upserting when favorites or layout read errors", async () => {
  let upsertCalls = 0;
  const makeStore = (over: Partial<DashboardSyncStore>): DashboardSyncStore => ({
    getUser: async () => ({ user: { id: "u1" } }),
    fetchFavoritesAndLayout: async () => ({
      favorites: [],
      favoritesError: null,
      layout: null,
      layoutError: null,
    }),
    upsertLayout: async () => {
      upsertCalls += 1;
      return {};
    },
    resolveWidgets: async () => new Map(),
    ...over,
  });

  const favErrRes = await executeDashboardSync(
    makeStore({
      fetchFavoritesAndLayout: async () => ({
        favorites: [],
        favoritesError: new Error("timeout"),
        layout: { id: "layout-1", user_id: "u1", config: { widgets: [{ id: "alta", type: "resort", x: 0, y: 0, w: 4, h: 3 }] }, updated_at: "2026-01-01T00:00:00Z" },
        layoutError: null,
      }),
    }),
  );
  assert.equal(favErrRes.status, "error");
  assert.equal(upsertCalls, 0);

  const layoutErrRes = await executeDashboardSync(
    makeStore({
      fetchFavoritesAndLayout: async () => ({
        favorites: [{ id: "f1", user_id: "u1", item_type: "resort", item_id: "alta", created_at: "2026-01-01T00:00:00Z" }],
        favoritesError: null,
        layout: null,
        layoutError: new Error("timeout"),
      }),
    }),
  );
  assert.equal(layoutErrRes.status, "error");
  assert.equal(upsertCalls, 0);

  const signedOutRes = await executeDashboardSync(
    makeStore({ getUser: async () => ({ user: null }) }),
  );
  assert.equal(signedOutRes.status, "signed_out");

  const okRes = await executeDashboardSync(
    makeStore({
      fetchFavoritesAndLayout: async () => ({
        favorites: [{ id: "f1", user_id: "u1", item_type: "resort", item_id: "alta", created_at: "2026-01-01T00:00:00Z" }],
        favoritesError: null,
        layout: null,
        layoutError: null,
      }),
    }),
  );
  assert.equal(okRes.status, "ok");
  assert.equal(upsertCalls, 1);
});

test("dashboard-layout breakpoint helpers preserve wider desktop widths across smaller breakpoints", () => {
  assert.equal(colsForViewportWidth(1400), 12);
  assert.equal(colsForViewportWidth(1000), 10);
  assert.equal(colsForViewportWidth(800), 6);
  assert.equal(colsForViewportWidth(500), 4);
  assert.equal(colsForViewportWidth(320), 2);

  const clamped = clampRglLayout([{ i: "alta", x: 5, y: 0, w: 8, h: 3 }], 6);
  assert.deepEqual(clamped, [{ i: "alta", x: 0, y: 0, w: 6, h: 3 }]);

  const desktopWidgets: WidgetConfig[] = [
    { id: "alta", type: "resort", x: 2, y: 0, w: 8, h: 4 },
  ];
  const mergedFromSm = mergeBreakpointLayoutChange(
    desktopWidgets,
    [{ i: "alta", x: 0, y: 2, w: 6, h: 4 }],
    6,
  );
  assert.equal(mergedFromSm[0].w, 8);
  assert.equal(mergedFromSm[0].x, 2);
  assert.equal(mergedFromSm[0].y, 2);

  // Explicit shrink below activeCols IS honored
  const explicitShrink = mergeBreakpointLayoutChange(
    desktopWidgets,
    [{ i: "alta", x: 0, y: 2, w: 4, h: 4 }],
    6,
  );
  assert.equal(explicitShrink[0].w, 4);

  const reconciledExit = reconcileEditExitLayout(
    [{ id: "alta", type: "resort", x: 0, y: 0, w: 6, h: 4 }],
    [
      { id: "alta", type: "resort", x: 0, y: 0, w: 4, h: 3 },
      { id: "vail", type: "resort", x: 4, y: 0, w: 4, h: 3 },
    ],
    true,
  );
  assert.deepEqual(reconciledExit, [
    { id: "alta", type: "resort", x: 0, y: 0, w: 6, h: 4 },
    { id: "vail", type: "resort", x: 4, y: 0, w: 4, h: 3 },
  ]);
  assert.equal(widgetLayoutsEqual(desktopWidgets, [{ id: "alta", type: "resort", x: 2, y: 0, w: 8, h: 4 }]), true);
  assert.equal(widgetLayoutsEqual(desktopWidgets, explicitShrink), false);
});
