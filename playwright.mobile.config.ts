import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /mobile-(review|flows)\.spec/,
  timeout: 45_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: "line",
  use: { baseURL: process.env.MOBILE_TEST_URL ?? "http://127.0.0.1:3116", trace: "retain-on-failure" },
  projects: [
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
});
