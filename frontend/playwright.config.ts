import { defineConfig, devices } from '@playwright/test'

/** End-to-end regression suite. Runs against an already running RMT:
 *  - CI: the backend serving the built frontend on :8000 (BASE_URL)
 *  - locally: `npm run dev` / the preview server — set BASE_URL if not :5191
 * Every test creates its own project through the API, so the suite can run
 * against a database that already has data in it. */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'e2e-results.xml' }]] : 'list',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5191',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'pl-PL',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
