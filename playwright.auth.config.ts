import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', testMatch: /(?:auth-account|reliability-ux|signup-lineup)\.spec/, workers: 1, timeout: 60_000,
  expect: { timeout: 15_000 }, reporter: 'line',
  // The Next dev server canonicalises callback redirects to `localhost`;
  // every page (including a callback opened in a second tab) must share that
  // origin or localStorage would be partitioned per host.
  use: { baseURL: 'http://localhost:3118', trace: 'retain-on-failure' },
  projects: [
    { name: 'auth-chromium', use: { ...devices['Pixel 7'] } },
    { name: 'auth-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: [
    { command: 'node tests/fixtures/auth-server.mjs', url: 'http://127.0.0.1:3119/health', reuseExistingServer: false },
    { command: 'npm run dev -- --webpack --hostname 127.0.0.1 --port 3118', url: 'http://127.0.0.1:3118/auth', timeout: 120_000, reuseExistingServer: false,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3119',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon-key',
        NEXT_PUBLIC_AUTH_EMAIL_CODE_ENABLED: 'true',
        // Every real analytics/ad destination is disabled in the fixture
        // environment. The browser suite also aborts these hosts defensively.
        NEXT_PUBLIC_POSTHOG_KEY: '',
        NEXT_PUBLIC_POSTHOG_HOST: '',
        NEXT_PUBLIC_META_PIXEL_ID: '',
        NEXT_PUBLIC_GOOGLE_ADS_ID: '',
        NEXT_PUBLIC_GOOGLE_ADS_ALERT_LABEL: '',
        NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL: '',
        NEXT_PUBLIC_REDDIT_PIXEL_ID: '',
        // Service-role alert writes stay inside the local fixture (no Resend
        // key, so the welcome email fails soft and no mail is sent).
        SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role-key',
        RESEND_API_KEY: '',
      } },
  ],
});
