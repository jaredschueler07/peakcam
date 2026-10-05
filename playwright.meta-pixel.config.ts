import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /meta-pixel\.spec/,
  workers: 1,
  reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3128', trace: 'retain-on-failure' },
  projects: [{ name: 'pixel-chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run start -- --hostname 127.0.0.1 --port 3128',
    url: 'http://127.0.0.1:3128/about',
    reuseExistingServer: false,
    env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3129', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key' },
  },
});
