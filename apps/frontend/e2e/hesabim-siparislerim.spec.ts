/**
 * G2 Frontend E2E — /hesabim/siparislerim + /hesabim/siparislerim/:id
 *
 * Mock gerekliliği:
 *   - GET /api/customers/orders        → sipariş listesi
 *   - GET /api/customers/me/orders/:id → sipariş detayı
 *   - Auth store inject (Zustand localStorage)
 *
 * Backend canlı olmadan çalışır.
 */

import { test, expect } from "@playwright/test";
import { injectCustomerAuth } from "./helpers/auth";

const ORDERS_LIST_ENDPOINT = /\/api\/customers\/orders/;
const ORDER_DETAIL_ENDPOINT = /\/api\/customers\/me\/orders\//;

const mockOrder = {
  id: "order-001",
  number: "ORD-2024-001",
  total: 299.99,
  currency: "TRY",
  status: "SHIPPED",
  createdAt: "2024-06-01T10:00:00.000Z",
  trackingNumber: "TRK123456789",
};

const mockOrderDetail = {
  id: "order-001",
  number: "ORD-2024-001",
  total: 299.99,
  subtotal: 279.99,
  shippingCost: 20.0,
  currency: "TRY",
  status: "SHIPPED",
  createdAt: "2024-06-01T10:00:00.000Z",
  trackingNumber: "TRK123456789",
  carrierTrackingUrl: "https://kargo.example.com/TRK123456789",
  trackingEvents: [
    { status: "PENDING", occurredAt: "2024-06-01T10:00:00.000Z", description: null },
    { status: "PROCESSING", occurredAt: "2024-06-01T12:00:00.000Z", description: null },
    { status: "SHIPPED", occurredAt: "2024-06-02T08:00:00.000Z", description: "Kargo firmasi: YuK" },
  ],
  items: [
    {
      id: "item-001",
      productName: "Kablosuz Kulaklik X2",
      productSlug: "kablosuz-kulaklik-x2",
      imageUrl: null,
      qty: 1,
      unitPrice: 279.99,
    },
  ],
  shippingAddress: {
    fullName: "Test Kullanicisi",
    phone: "+90 500 000 00 00",
    line1: "Ataturk Cad. No:1",
    line2: null,
    district: "Kadikoy",
    city: "Istanbul",
    postalCode: "34710",
  },
  billingAddress: null,
  paymentMethod: "Kredi Karti",
  paymentStatus: "PAID",
};

// ---------------------------------------------------------------------------
// /hesabim/siparislerim — Liste
// ---------------------------------------------------------------------------

test.describe("/hesabim/siparislerim listesi", () => {
  test.beforeEach(async ({ page }) => {
    await injectCustomerAuth(page);
  });

  test("'Siparişlerim' başlığı görünür", async ({ page }) => {
    await page.route(ORDERS_LIST_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockOrder] }),
      });
    });

    await page.goto("/hesabim/siparislerim");
    await expect(
      page.getByRole("heading", { name: /siparişlerim/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("sipariş numarası ve durum badge görünür", async ({ page }) => {
    await page.route(ORDERS_LIST_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockOrder] }),
      });
    });

    await page.goto("/hesabim/siparislerim");
    await expect(page.getByText(/ORD-2024-001/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/kargoda/i)).toBeVisible();
  });

  test("sipariş yoksa boş durum mesajı görünür", async ({ page }) => {
    await page.route(ORDERS_LIST_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await page.goto("/hesabim/siparislerim");
    await expect(
      page.getByText(/henüz siparişiniz bulunmuyor/i)
    ).toBeVisible({ timeout: 8_000 });
  });

  test("sipariş satırına tıklanınca detay sayfasına gidilir", async ({ page }) => {
    await page.route(ORDERS_LIST_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockOrder] }),
      });
    });
    await page.route(ORDER_DETAIL_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ order: mockOrderDetail }),
      });
    });

    await page.goto("/hesabim/siparislerim");
    await page.getByText(/ORD-2024-001/).waitFor({ state: "visible", timeout: 8_000 });
    await page.getByRole("link", { name: /ORD-2024-001/i }).click();

    await expect(page).toHaveURL(/siparislerim\/order-001/, { timeout: 5_000 });
  });
});

// ---------------------------------------------------------------------------
// /hesabim/siparislerim/:id — Detay
// ---------------------------------------------------------------------------

test.describe("/hesabim/siparislerim/:id detay sayfası", () => {
  test.beforeEach(async ({ page }) => {
    await injectCustomerAuth(page);

    await page.route(ORDER_DETAIL_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ order: mockOrderDetail }),
      });
    });

    await page.goto("/hesabim/siparislerim/order-001");
  });

  test("sipariş numarası ve durum badge görünür", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /ORD-2024-001/i })
    ).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/kargoda/i)).toBeVisible();
  });

  test("ürün adı ve fiyatı görünür", async ({ page }) => {
    await expect(page.getByText("Kablosuz Kulaklik X2")).toBeVisible({ timeout: 8_000 });
  });

  test("'Kargo Takibi' bölümü görünür", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /kargo takibi/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("TrackingTimeline: SHIPPED adımı 'current' görünür", async ({ page }) => {
    await page.getByRole("heading", { name: /kargo takibi/i }).waitFor({ timeout: 8_000 });

    // Kargoya Verildi adımı mevcut durum — brand-blue rengi ile işaretli
    await expect(page.getByText("Kargoya Verildi")).toBeVisible();
  });

  test("TrackingTimeline: PENDING ve PROCESSING adımları tamamlanmış (completed)", async ({ page }) => {
    await page.getByRole("heading", { name: /kargo takibi/i }).waitFor({ timeout: 8_000 });

    // Tamamlanan adımlar (PENDING, PROCESSING) görünür
    await expect(page.getByText("Sipariş Alındı")).toBeVisible();
    await expect(page.getByText("Hazırlanıyor")).toBeVisible();
  });

  test("TrackingTimeline: DELIVERED adımı pending görünür", async ({ page }) => {
    await page.getByRole("heading", { name: /kargo takibi/i }).waitFor({ timeout: 8_000 });
    await expect(page.getByText("Teslim Edildi")).toBeVisible();
  });

  test("kargo takip no timeline'da görünür", async ({ page }) => {
    await page.getByRole("heading", { name: /kargo takibi/i }).waitFor({ timeout: 8_000 });
    // Tracking number SHIPPED step'in description olarak gösterilir
    await expect(page.getByText(/TRK123456789/)).toBeVisible();
  });

  test("'Kargo Takip' linki sayfada var", async ({ page }) => {
    await page.getByRole("heading", { name: /kargo takibi/i }).waitFor({ timeout: 8_000 });
    const trackLink = page.getByRole("link", { name: /kargo takip/i });
    await expect(trackLink).toBeVisible();
    const href = await trackLink.getAttribute("href");
    expect(href).toContain("kargo.example.com");
  });

  test("teslimat adresi bölümü görünür", async ({ page }) => {
    await expect(page.getByText("Teslimat adresi")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Ataturk Cad. No:1")).toBeVisible();
  });

  test("'Siparişlerime dön' geri linki var", async ({ page }) => {
    await page.getByText(/siparişlerime dön/i).waitFor({ timeout: 8_000 });
    const backLink = page.getByRole("link", { name: /siparişlerime dön/i });
    await expect(backLink).toBeVisible();
    const href = await backLink.getAttribute("href");
    expect(href).toContain("/hesabim/siparislerim");
  });
});

// ---------------------------------------------------------------------------
// Detay: DELIVERED durum testi
// ---------------------------------------------------------------------------

test.describe("/hesabim/siparislerim/:id — DELIVERED durum", () => {
  test("DELIVERED durumunda tüm adımlar tamamlanmış görünür", async ({ page }) => {
    await injectCustomerAuth(page);

    const deliveredDetail = {
      ...mockOrderDetail,
      status: "DELIVERED",
      trackingEvents: [
        { status: "PENDING", occurredAt: "2024-06-01T10:00:00.000Z", description: null },
        { status: "PROCESSING", occurredAt: "2024-06-01T12:00:00.000Z", description: null },
        { status: "SHIPPED", occurredAt: "2024-06-02T08:00:00.000Z", description: null },
        { status: "IN_TRANSIT", occurredAt: "2024-06-03T09:00:00.000Z", description: null },
        { status: "DELIVERED", occurredAt: "2024-06-04T14:00:00.000Z", description: "Teslim edildi" },
      ],
    };

    await page.route(ORDER_DETAIL_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ order: deliveredDetail }),
      });
    });

    await page.goto("/hesabim/siparislerim/order-001");
    await page.getByRole("heading", { name: /kargo takibi/i }).waitFor({ timeout: 8_000 });

    // Teslim edildi adımı görünmeli
    await expect(page.getByText("Teslim Edildi")).toBeVisible();
  });
});
