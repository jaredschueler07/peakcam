import { defineConfig, devices } from "@playwright/test";

/**
 * Default project runs the functional drop-in suite. `chromium-heap` is the
 * P11 zero-allocation guard: Chromium with `--js-flags=--expose-gc` so the
 * heap e2e can force GC and sample `performance.memory.usedJSHeapSize`.
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

