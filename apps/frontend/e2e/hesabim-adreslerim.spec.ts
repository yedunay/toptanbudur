/**
 * G2 Frontend E2E — /hesabim/adreslerim
 *
 * Mock gerekliliği:
 *   - GET  /api/customers/me/addresses → adres listesi
 *   - POST /api/customers/me/addresses → oluştur
 *   - PATCH /api/customers/me/addresses/:id → güncelle / varsayılan yap
 *   - DELETE /api/customers/me/addresses/:id → sil
 *   - Auth store inject (Zustand localStorage)
 *
 * Backend canlı olmadan çalışır.
 */

import { test, expect } from "@playwright/test";
import { injectCustomerAuth, DEFAULT_CUSTOMER } from "./helpers/auth";

const ADDRESSES_ENDPOINT = /\/api\/customers\/me\/addresses/;

const mockAddress = {
  id: "addr-001",
  title: "Ev",
  fullName: "Test Kullanicisi",
  phone: "+90 500 000 00 00",
  line1: "Atatürk Cad. No:1",
  line2: null,
  district: "Kadikoy",
  city: "Istanbul",
  postalCode: "34710",
  country: "TR",
  isDefault: true,
  isDefaultShipping: false,
  isDefaultBilling: false,
};

const mockAddress2 = {
  id: "addr-002",
  title: "Is",
  fullName: "Test Kullanicisi",
  phone: "+90 500 000 00 00",
  line1: "Bagdat Cad. No:42",
  line2: null,
  district: "Maltepe",
  city: "Istanbul",
  postalCode: "34840",
  country: "TR",
  isDefault: false,
  isDefaultShipping: false,
  isDefaultBilling: false,
};

test.describe("/hesabim/adreslerim sayfası", () => {
  test.beforeEach(async ({ page }) => {
    await injectCustomerAuth(page);
  });

  // ── GET: liste yüklenmesi ────────────────────────────────────────────────

  test("adres listesi yüklenince 'Adreslerim' başlığı görünür", async ({ page }) => {
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ addresses: [mockAddress] }),
      });
    });

    await page.goto("/hesabim/adreslerim");
    const heading = page.getByRole("heading", { name: /adreslerim/i });
    await expect(heading).toBeVisible({ timeout: 8_000 });
  });

  test("API'den gelen adres kartı görünür ve başlık doğru", async ({ page }) => {
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ addresses: [mockAddress] }),
      });
    });

    await page.goto("/hesabim/adreslerim");
    await expect(page.getByText("Ev")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Varsayılan")).toBeVisible();
  });

  test("kayıtlı adres yoksa boş durum mesajı görünür", async ({ page }) => {
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ addresses: [] }),
      });
    });

    await page.goto("/hesabim/adreslerim");
    await expect(
      page.getByText(/kayıtlı adresiniz bulunmuyor/i)
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Yeni adres ekleme ───────────────────────────────────────────────────

  test("'+ Yeni adres ekle' butonuna tıklayınca form açılır", async ({ page }) => {
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ addresses: [mockAddress] }),
      });
    });

    await page.goto("/hesabim/adreslerim");
    await page.getByText(/adreslerim/i).waitFor({ state: "visible", timeout: 8_000 });

    await page.getByRole("button", { name: /yeni adres ekle/i }).click();
    await expect(page.getByRole("heading", { name: /yeni adres/i })).toBeVisible();
  });

  test("adres formu validation: başlık boşsa 'Başlık zorunlu' hatası", async ({ page }) => {
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ addresses: [] }),
      });
    });

    await page.goto("/hesabim/adreslerim");
    // Boş durum CTA butonu
    await page.getByRole("button", { name: /ilk adresinizi ekleyin/i }).waitFor({ timeout: 8_000 });
    await page.getByRole("button", { name: /ilk adresinizi ekleyin/i }).click();

    // Boş form gönder
    await page.getByRole("button", { name: /^kaydet$/i }).click();
    await expect(page.getByText("Başlık zorunlu")).toBeVisible({ timeout: 3_000 });
  });

  test("geçerli adres formu gönderilince POST isteği atılır ve başarı toast görünür", async ({ page }) => {
    let callCount = 0;
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({ address: { ...mockAddress2, id: "addr-new" } }),
        });
      } else {
        // GET — callCount'a göre cevap ver
        callCount++;
        const list = callCount === 1 ? [] : [mockAddress2];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ addresses: list }),
        });
      }
    });

    await page.goto("/hesabim/adreslerim");
    await page.getByRole("button", { name: /ilk adresinizi ekleyin/i }).waitFor({ timeout: 8_000 });
    await page.getByRole("button", { name: /ilk adresinizi ekleyin/i }).click();

    // Formu doldur
    await page.locator("#title").fill("Is");
    await page.locator("#fullName").fill("Test Kullanicisi");
    await page.locator("#phone").fill("+90 500 000 00 00");
    await page.locator("#line1").fill("Bagdat Cad. No:42");
    await page.locator("#district").fill("Maltepe");
    await page.locator("#city").fill("Istanbul");
    await page.locator("#postalCode").fill("34840");

    await page.getByRole("button", { name: /^kaydet$/i }).click();

    await expect(page.getByText(/adres eklendi/i)).toBeVisible({ timeout: 5_000 });
  });

  // ── Düzenle ─────────────────────────────────────────────────────────────

  test("'Düzenle' butonuna tıklayınca edit formu açılır", async ({ page }) => {
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ addresses: [mockAddress] }),
      });
    });

    await page.goto("/hesabim/adreslerim");
    await page.getByText("Ev").waitFor({ state: "visible", timeout: 8_000 });

    await page.getByRole("button", { name: /düzenle/i }).first().click();
    await expect(page.getByRole("heading", { name: /adresi düzenle/i })).toBeVisible();
  });

  test("edit formunu güncelleyince PATCH isteği atılır ve 'Adres güncellendi' toast görünür", async ({ page }) => {
    let patchCalled = false;
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        patchCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ address: { ...mockAddress, title: "Ev 2" } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ addresses: [mockAddress] }),
        });
      }
    });

    await page.goto("/hesabim/adreslerim");
    await page.getByText("Ev").waitFor({ state: "visible", timeout: 8_000 });

    await page.getByRole("button", { name: /düzenle/i }).first().click();
    await page.locator("#title").fill("Ev 2");
    await page.getByRole("button", { name: /^kaydet$/i }).click();

    await expect(page.getByText(/adres güncellendi/i)).toBeVisible({ timeout: 5_000 });
    expect(patchCalled).toBe(true);
  });

  // ── Varsayılan yap ───────────────────────────────────────────────────────

  test("'Varsayılan yap' butonuna tıklayınca PATCH isDefault:true gönderilir", async ({ page }) => {
    let patchBody: unknown = null;
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "PATCH") {
        patchBody = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ address: { ...mockAddress2, isDefault: true } }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ addresses: [mockAddress, mockAddress2] }),
        });
      }
    });

    await page.goto("/hesabim/adreslerim");
    await page.getByText("Is").waitFor({ state: "visible", timeout: 8_000 });

    // "Is" adresinin varsayılan yap butonu (mockAddress2 varsayılan değil)
    const varButton = page.getByRole("button", { name: /varsayılan yap/i }).first();
    await expect(varButton).toBeVisible();
    await varButton.click();

    await expect(page.getByText(/varsayılan adres ayarlandı/i)).toBeVisible({ timeout: 5_000 });
    expect((patchBody as { isDefault?: boolean })?.isDefault).toBe(true);
  });

  // ── Sil ─────────────────────────────────────────────────────────────────

  test("'Sil' butonuna tıklayınca confirm dialog açılır ve iptal edince silme olmaz", async ({ page }) => {
    let deleteCalled = false;
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      if (route.request().method() === "DELETE") {
        deleteCalled = true;
        await route.fulfill({ status: 204 });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ addresses: [mockAddress] }),
        });
      }
    });

    // window.confirm → false (iptal)
    page.on("dialog", (dialog) => dialog.dismiss());

    await page.goto("/hesabim/adreslerim");
    await page.getByText("Ev").waitFor({ state: "visible", timeout: 8_000 });

    await page.getByRole("button", { name: /^sil$/i }).first().click();
    // dialog dismiss edildi
    expect(deleteCalled).toBe(false);
  });

  test("'Sil' onaylanınca DELETE isteği atılır ve 'Adres silindi' toast görünür", async ({ page }) => {
    let callCount = 0;
    await page.route(ADDRESSES_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "DELETE") {
        await route.fulfill({ status: 204 });
      } else {
        callCount++;
        const list = callCount === 1 ? [mockAddress] : [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ addresses: list }),
        });
      }
    });

    // window.confirm → true (onayla)
    page.on("dialog", (dialog) => dialog.accept());

    await page.goto("/hesabim/adreslerim");
    await page.getByText("Ev").waitFor({ state: "visible", timeout: 8_000 });

    await page.getByRole("button", { name: /^sil$/i }).first().click();

    await expect(page.getByText(/adres silindi/i)).toBeVisible({ timeout: 5_000 });
  });
});
