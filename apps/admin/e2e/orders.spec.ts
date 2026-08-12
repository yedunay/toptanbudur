/**
 * G3 Admin E2E — /admin/orders/:id (OrderDetailPage)
 *
 * Mock gerekliliği:
 *   - GET  /api/orders/:id → sipariş detayı
 *   - PATCH /api/orders/:id → durum güncelleme
 *   - Auth: localStorage "tb_admin_token" inject
 *
 * Backend canlı olmadan çalışır.
 */

import { test, expect } from "@playwright/test";
import { injectAdminAuth } from "./helpers/auth";

const ORDER_ENDPOINT = /\/api\/admin\/orders\/order-001/;

const mockOrder = {
  id: "order-001",
  orderNumber: "ORD-2024-001",
  status: "PAID",
  total: 599.98,
  subtotal: 559.98,
  shippingFee: 40.0,
  createdAt: "2024-06-01T10:00:00.000Z",
  trackingNumber: null,
  customerName: "Test Kullanicisi",
  customerEmail: "test@example.com",
  items: [
    {
      id: "item-001",
      productName: "Kablosuz Kulaklik X1",
      sku: "ASX-001",
      quantity: 2,
      unitPrice: 279.99,
      total: 559.98,
    },
  ],
  shippingAddress: {
    fullName: "Test Kullanicisi",
    line1: "Ataturk Cad. No:1",
    line2: null,
    district: "Kadikoy",
    city: "Istanbul",
    postalCode: "34710",
    phone: "+90 555 000 00 00",
  },
  timeline: [
    { status: "PENDING", at: "2024-06-01T10:00:00.000Z", note: null },
    { status: "PAID", at: "2024-06-01T10:05:00.000Z", note: null },
  ],
};

test.describe("Admin — Sipariş detay ve durum güncelleme (/admin/orders/:id)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminAuth(page);

    await page.route(ORDER_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockOrder),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/admin/orders/order-001");
  });

  // ── Sayfa yüklenmesi ─────────────────────────────────────────────────────

  test("sipariş numarası başlıkta görünür", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /ORD-2024-001/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("ürün adı tabloda görünür", async ({ page }) => {
    await expect(page.getByText("Kablosuz Kulaklik X1")).toBeVisible({ timeout: 8_000 });
  });

  test("müşteri adı görünür", async ({ page }) => {
    await expect(page.getByText("Test Kullanicisi")).toBeVisible({ timeout: 8_000 });
  });

  test("durum geçmişi 'Durum geçmişi' başlığı altında görünür", async ({ page }) => {
    await expect(page.getByText("Durum geçmişi")).toBeVisible({ timeout: 8_000 });
  });

  // ── Durum değiştirme ─────────────────────────────────────────────────────

  test("durum dropdown mevcut durumu gösterir", async ({ page }) => {
    await page.getByRole("heading", { name: /ORD-2024-001/i }).waitFor({ timeout: 8_000 });

    // PAID durumunda "Ödendi" seçili olmalı
    const statusSelect = page.locator("select").first();
    const selectedValue = await statusSelect.inputValue();
    expect(selectedValue).toBe("PAID");
  });

  test("durum SHIPPED olarak değiştirilince 'Güncelle' tıklanınca PATCH gönderilir", async ({ page }) => {
    let patchBody: unknown = null;
    await page.route(ORDER_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        patchBody = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...mockOrder, status: "SHIPPED" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockOrder),
        });
      }
    });

    await page.getByRole("heading", { name: /ORD-2024-001/i }).waitFor({ timeout: 8_000 });

    // Durum dropdown'ını SHIPPED yap
    await page.locator("select").first().selectOption("SHIPPED");

    // Güncelle butonu
    await page.getByRole("button", { name: /güncelle/i }).click();

    await expect(page.getByText(/sipariş güncellendi/i)).toBeVisible({ timeout: 5_000 });
    expect((patchBody as { status?: string })?.status).toBe("SHIPPED");
  });

  test("kargo takip no girilince PATCH body'de trackingNumber gönderilir", async ({ page }) => {
    let patchBody: unknown = null;
    await page.route(ORDER_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        patchBody = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...mockOrder, trackingNumber: "TRK999888777" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockOrder),
        });
      }
    });

    await page.getByRole("heading", { name: /ORD-2024-001/i }).waitFor({ timeout: 8_000 });

    // Kargo takip no input
    const trackingInput = page.locator("input.font-mono");
    await trackingInput.fill("TRK999888777");

    await page.getByRole("button", { name: /güncelle/i }).click();

    await expect(page.getByText(/sipariş güncellendi/i)).toBeVisible({ timeout: 5_000 });
    expect((patchBody as { trackingNumber?: string })?.trackingNumber).toBe("TRK999888777");
  });

  test("PATCH hata döndürünce error toast görünür", async ({ page }) => {
    await page.route(ORDER_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Sunucu hatasi" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(mockOrder),
        });
      }
    });

    await page.getByRole("heading", { name: /ORD-2024-001/i }).waitFor({ timeout: 8_000 });

    await page.getByRole("button", { name: /güncelle/i }).click();

    await expect(page.getByText(/güncelleme başarısız|sunucu hatasi/i)).toBeVisible({ timeout: 5_000 });
  });

  // ── Geri linki ────────────────────────────────────────────────────────────

  test("'← Siparişler' geri linki mevcut", async ({ page }) => {
    await page.getByRole("heading", { name: /ORD-2024-001/i }).waitFor({ timeout: 8_000 });

    const backLink = page.getByRole("link", { name: /siparişler/i });
    await expect(backLink).toBeVisible();
    const href = await backLink.getAttribute("href");
    expect(href).toContain("/orders");
  });
});
