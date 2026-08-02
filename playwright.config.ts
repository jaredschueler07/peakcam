import { defineConfig, devices } from "@playwright/test";

/**
 * Default project runs the functional drop-in suite. `chromium-heap` is the
 * P11 zero-allocation guard: Chromium with `--js-flags=--expose-gc` so the
 * heap e2e can force GC and sample `performance.memory.usedJSHeapSize`.
 *
 * Backend matrix (P11 Task 6). Production now defaults to WebGPU, but headless
 * Chromium's WebGPU adapter is SwiftShader, which renders the canvas black —
 * so every pixel-reading spec would fail for a reason that has nothing to do
 * with the code. The default `chromium` project therefore pins `?gfx=webgl`
 * through `dropInUrl()` in the spec, and the real-WebGPU coverage lives in
 * `chromium-webgpu`, which needs a headed run on hardware and is excluded from
 * the default sweep. Run it at the gate:
 *
 *   npx playwright test --project=chromium-webgpu --headed
 */
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /drop-in-heap/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // Real WebGPU. Headed only — a headless run gets SwiftShader and a black
      // canvas. Not part of the default sweep; the gate runs it explicitly.
      name: "chromium-webgpu",
      testMatch: /drop-in\.spec/,
      use: { ...devices["Desktop Chrome"], headless: false },
    },
    {
      name: "chromium-heap",
      testMatch: /drop-in-heap/,
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--js-flags=--expose-gc", "--enable-precise-memory-info"],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

