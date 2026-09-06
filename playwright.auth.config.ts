import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: /auth-account\.spec/, workers: 1, timeout: 60_000,
  expect: { timeout: 15_000 }, reporter: 'line',
  use: { baseURL: 'http://127.0.0.1:3118', trace: 'retain-on-failure' },
  projects: [
    { name: 'auth-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'auth-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: [
    { command: 'node tests/fixtures/auth-server.mjs', url: 'http://127.0.0.1:3119/health', reuseExistingServer: false },
    { command: 'npm run dev -- --webpack --hostname 127.0.0.1 --port 3118', url: 'http://127.0.0.1:3118/auth', timeout: 120_000, reuseExistingServer: false,
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3119', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key', NEXT_PUBLIC_AUTH_EMAIL_CODE_ENABLED: 'true', NEXT_PUBLIC_POSTHOG_KEY: '', NEXT_PUBLIC_META_PIXEL_ID: '' } },
  ],
});
