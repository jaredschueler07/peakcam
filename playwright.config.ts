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
 * `chromium-webgpu`.
 *
 * That project is opt-in **by construction**: it is absent from `projects`
 * unless `PLAYWRIGHT_WEBGPU=1`. Excluding it by convention was not enough —
 * `npx playwright test <file>` with no `--project` runs every configured
 * project, so a plain or file-scoped invocation would have launched it
 * headless and failed its three canvas specs on SwiftShader. Run it at the
 * gate, on hardware:
 *
 *   PLAYWRIGHT_WEBGPU=1 npx playwright test --project=chromium-webgpu --headed
 */
const webgpuProjects = process.env.PLAYWRIGHT_WEBGPU === "1"
  ? [{
      // Real WebGPU. Headed only — headless gets SwiftShader and a black canvas.
      name: "chromium-webgpu",
      testMatch: /drop-in\.spec/,
      use: { ...devices["Desktop Chrome"], headless: false },
    }]
  : [];

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
    ...webgpuProjects,
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

