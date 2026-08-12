/**
 * Admin E2E Test Helpers — Auth Mocking
 *
 * localStorage'a "tb_admin_token" inject ederek admin sayfalarını
 * auth edilmiş gibi açar. TOKEN_KEY, apps/admin/src/lib/auth.ts ile eşleşmeli.
 */

import type { Page } from "@playwright/test";

const TOKEN_KEY = "tb_admin_token";
const FAKE_TOKEN = "test-admin-jwt-token";

/**
 * Admin token'ını localStorage'a inject eder.
 * page.addInitScript kullanır — sayfa scriptleri yüklenmeden önce çalışır.
 */
export async function injectAdminAuth(page: Page): Promise<void> {
  await page.addInitScript(
    ({ key, token }) => {
      try {
        window.localStorage.setItem(key, token);
      } catch {
        // ignore
      }
    },
    { key: TOKEN_KEY, token: FAKE_TOKEN }
  );
}

/**
 * /api/** isteklerini 401 ile reddeden mock — admin auth redirect testleri için.
 */
export async function mockAdminUnauthorized(page: Page): Promise<void> {
  await page.route("/api/**", async (route) => {
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ message: "Unauthorized" }),
    });
  });
}
