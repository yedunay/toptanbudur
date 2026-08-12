/**
 * G2 Frontend E2E — /hesabim/profil
 *
 * Mock gerekliliği:
 *   - GET /api/customers/me  → profil verisi
 *   - PATCH /api/customers/me → güncelleme
 *   - Auth store inject (Zustand localStorage)
 *
 * Backend canlı olmadan çalışır.
 */

import { test, expect } from "@playwright/test";
import { injectCustomerAuth, DEFAULT_CUSTOMER } from "./helpers/auth";

const PROFILE_ENDPOINT = /\/api\/customers\/me/;

/** GET /api/customers/me mock response */
const mockProfileGet = {
  id: DEFAULT_CUSTOMER.id,
  email: DEFAULT_CUSTOMER.email,
  name: DEFAULT_CUSTOMER.name,
  firstName: "Test",
  lastName: "Kullanicisi",
  phone: DEFAULT_CUSTOMER.phone,
};

test.describe("/hesabim/profil sayfası", () => {
  test.beforeEach(async ({ page }) => {
    // Auth inject
    await injectCustomerAuth(page);

    // GET /api/customers/me mock
    await page.route(PROFILE_ENDPOINT, async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ customer: mockProfileGet }),
        });
      } else {
        // PATCH — aşağıdaki testlerde override edilir
        await route.continue();
      }
    });

    await page.goto("/hesabim/profil");
  });

  // ── GET: profil yüklenme ──────────────────────────────────────────────────

  test("sayfa yüklenince 'Profil bilgilerim' başlığı görünür", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /profil bilgilerim/i });
    await expect(heading).toBeVisible({ timeout: 8_000 });
  });

  test("API'den gelen ad/soyad form alanlarına yansıyor", async ({ page }) => {
    const firstName = page.getByLabel("Ad");
    await expect(firstName).toHaveValue("Test", { timeout: 8_000 });

    const lastName = page.getByLabel("Soyad");
    await expect(lastName).toHaveValue("Kullanicisi");
  });

  test("API'den gelen e-posta form alanına yansıyor", async ({ page }) => {
    const email = page.getByLabel("E-posta");
    await expect(email).toHaveValue(DEFAULT_CUSTOMER.email, { timeout: 8_000 });
  });

  // ── Validation ────────────────────────────────────────────────────────────

  test("ad boş bırakılırsa 'Ad zorunlu' hatası gösterilir", async ({ page }) => {
    await page.getByLabel("Ad").waitFor({ state: "visible", timeout: 8_000 });

    await page.getByLabel("Ad").clear();
    await page.getByRole("button", { name: /kaydet/i }).click();

    await expect(page.getByText("Ad zorunlu")).toBeVisible({ timeout: 3_000 });
  });

  test("geçersiz e-posta → 'Geçerli bir e-posta girin' hatası", async ({ page }) => {
    await page.getByLabel("E-posta").waitFor({ state: "visible", timeout: 8_000 });

    await page.getByLabel("E-posta").fill("gecersiz");
    await page.getByRole("button", { name: /kaydet/i }).click();

    await expect(page.getByText(/geçerli bir e-posta girin/i)).toBeVisible({ timeout: 3_000 });
  });

  // ── PATCH: güncelleme ─────────────────────────────────────────────────────

  test("geçerli form submit → PATCH isteği atılır ve success toast görünür", async ({ page }) => {
    // PATCH mock
    await page.route(PROFILE_ENDPOINT, async (route) => {
      if (route.request().method() === "PATCH") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            customer: {
              ...mockProfileGet,
              firstName: body.firstName ?? mockProfileGet.firstName,
              lastName: body.lastName ?? mockProfileGet.lastName,
              name: `${body.firstName ?? "Test"} ${body.lastName ?? "Kullanicisi"}`,
            },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ customer: mockProfileGet }),
        });
      }
    });

    await page.goto("/hesabim/profil");

    await page.getByLabel("Ad").waitFor({ state: "visible", timeout: 8_000 });
    await page.getByLabel("Ad").fill("Yeni");
    await page.getByLabel("Soyad").fill("Ad");

    await page.getByRole("button", { name: /kaydet/i }).click();

    // Toast görünmeli
    await expect(page.getByText(/profil bilgileriniz kaydedildi/i)).toBeVisible({ timeout: 5_000 });
  });

  test("PATCH 400 hatası → error toast görünür", async ({ page }) => {
    await page.route(PROFILE_ENDPOINT, async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "E-posta zaten kullanımda" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ customer: mockProfileGet }),
        });
      }
    });

    await page.goto("/hesabim/profil");
    await page.getByLabel("Ad").waitFor({ state: "visible", timeout: 8_000 });

    await page.getByRole("button", { name: /kaydet/i }).click();

    // Hata toast
    await expect(page.getByText(/profil güncellenemedi|e-posta zaten/i)).toBeVisible({ timeout: 5_000 });
  });

  // ── Sidebar nav ────────────────────────────────────────────────────────────

  test("sidebar'da 'Şifre Değiştir' linki /hesabim/profil/sifre'ye gidiyor", async ({ page }) => {
    await page.getByLabel("Ad").waitFor({ state: "visible", timeout: 8_000 });

    const sifreLink = page.getByRole("link", { name: /şifre/i });
    await expect(sifreLink).toBeVisible();
    const href = await sifreLink.getAttribute("href");
    expect(href).toContain("/hesabim/profil/sifre");
  });
});

// ---------------------------------------------------------------------------
// /hesabim/profil/sifre
// ---------------------------------------------------------------------------

test.describe("/hesabim/profil/sifre sayfası", () => {
  test.beforeEach(async ({ page }) => {
    await injectCustomerAuth(page);

    // Profil GET mock (layout için gerekli)
    await page.route(PROFILE_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ customer: mockProfileGet }),
      });
    });

    // Şifre PATCH endpoint mock
    await page.route(/\/api\/customers\/me\/password/, async (route) => {
      await route.continue();
    });

    await page.goto("/hesabim/profil/sifre");
  });

  test("'Şifre değiştir' başlığı görünür", async ({ page }) => {
    const heading = page.getByRole("heading", { name: /şifre değiştir/i });
    await expect(heading).toBeVisible({ timeout: 8_000 });
  });

  test("yeni şifre < 8 karakter → 'En az 8 karakter' hatası", async ({ page }) => {
    await page.getByLabel("Mevcut şifre").fill("eskisifre123");
    await page.getByLabel("Yeni şifre").fill("kisa1");
    await page.getByLabel(/yeni şifre \(tekrar\)/i).fill("kisa1");
    await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

    await expect(page.getByText(/en az 8 karakter/i)).toBeVisible({ timeout: 3_000 });
  });

  test("harf içermeyen şifre → 'En az 1 harf ve 1 rakam' hatası", async ({ page }) => {
    await page.getByLabel("Mevcut şifre").fill("eskisifre123");
    await page.getByLabel("Yeni şifre").fill("12345678");
    await page.getByLabel(/yeni şifre \(tekrar\)/i).fill("12345678");
    await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

    await expect(page.getByText(/en az 1 harf ve 1 rakam/i)).toBeVisible({ timeout: 3_000 });
  });

  test("şifreler eşleşmiyorsa → 'Şifreler eşleşmiyor' hatası", async ({ page }) => {
    await page.getByLabel("Mevcut şifre").fill("eskisifre123");
    await page.getByLabel("Yeni şifre").fill("Yeni1234");
    await page.getByLabel(/yeni şifre \(tekrar\)/i).fill("Farkli9876");
    await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

    await expect(page.getByText(/şifreler eşleşmiyor/i)).toBeVisible({ timeout: 3_000 });
  });

  test("geçerli şifre → PATCH isteği atılır ve success toast", async ({ page }) => {
    await page.route(/\/api\/customers\/me\/password/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await page.goto("/hesabim/profil/sifre");

    await page.getByLabel("Mevcut şifre").waitFor({ state: "visible", timeout: 8_000 });
    await page.getByLabel("Mevcut şifre").fill("eskisifre123");
    await page.getByLabel("Yeni şifre").fill("Yenisifre9");
    await page.getByLabel(/yeni şifre \(tekrar\)/i).fill("Yenisifre9");
    await page.getByRole("button", { name: /şifreyi güncelle/i }).click();

    await expect(page.getByText(/şifreniz başarıyla güncellendi/i)).toBeVisible({ timeout: 5_000 });
  });
});
