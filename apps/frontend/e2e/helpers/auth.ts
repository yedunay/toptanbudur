/**
 * Frontend E2E Test Helpers — Auth Mocking
 *
 * Zustand store'daki customer state'i inject ederek sayfaları auth edilmiş
 * gibi açar. Bu sayede gerçek bir backend'e gerek kalmaz.
 */

import type { Page } from "@playwright/test";

export interface MockCustomer {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
}

export const DEFAULT_CUSTOMER: MockCustomer = {
  id: "test-customer-001",
  email: "test@example.com",
  name: "Test Kullanicisi",
  phone: "+90 500 000 00 00",
};

/**
 * localStorage veya Zustand store'a customer inject eder.
 * frontend/lib/auth.ts'deki store key'ini kullanır.
 */
export async function injectCustomerAuth(
  page: Page,
  customer: MockCustomer = DEFAULT_CUSTOMER
): Promise<void> {
  await page.addInitScript((c) => {
    // Zustand persist store key — lib/auth.ts içindeki key ile eşleşmeli
    const storeKey = "tb-customer";
    const storeValue = JSON.stringify({
      state: { customer: c },
      version: 0,
    });
    try {
      window.localStorage.setItem(storeKey, storeValue);
    } catch {
      // ignore
    }
  }, customer);
}

/**
 * Tüm /api/** isteklerini 401 ile reddeden mock — auth redirect testleri için.
 */
export async function mockUnauthorized(page: Page): Promise<void> {
  await page.route("/api/**", async (route) => {
    await route.fulfill({ status: 401, body: JSON.stringify({ error: "Unauthorized" }) });
  });
}
