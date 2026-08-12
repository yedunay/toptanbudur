import { defineConfig, devices } from "@playwright/test";

/**
 * Admin (Vite SPA) Playwright config.
 *
 * Run:  npx playwright test --config=apps/admin/playwright.config.ts
 *
 * basename="/admin" — tüm test URL'leri /admin ile başlar.
 * Tüm API istekleri page.route() mock ile simüle edilir.
 * Gerçek backend URL'si ADMIN_URL env ile override edilir.
 */

const BASE_URL = process.env.ADMIN_URL ?? "http://localhost:3001";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,

  reporter: [
    ["html", { outputFolder: "playwright-report", open: "never" }],
    ["junit", { outputFile: "playwright-report/results.xml" }],
    ["list"],
  ],

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],

  outputDir: "test-results",
  snapshotDir: "e2e/__snapshots__",

  webServer: process.env.CI
    ? {
        command: "npm run preview",
        url: BASE_URL,
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : undefined,
});
