/**
 * G3 Admin E2E — /admin/suppliers/new (SupplierFormPage)
 *
 * Mock gerekliliği:
 *   - POST /api/suppliers → tedarikçi oluştur
 *   - Auth: localStorage "tb_admin_token" inject
 *
 * Backend canlı olmadan çalışır.
 */

import { test, expect } from "@playwright/test";
import { injectAdminAuth } from "./helpers/auth";

const SUPPLIERS_ENDPOINT = /\/api\/admin\/suppliers/;

test.describe("Admin — Yeni tedarikçi formu (/admin/suppliers/new)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminAuth(page);

    // GET /api/suppliers — liste sayfası için (AdminShell navigation)
    await page.route(SUPPLIERS_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20 }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto("/admin/suppliers/new");
  });

  // ── Sayfa yüklenmesi ─────────────────────────────────────────────────────

  test("'Yeni tedarikçi' başlığı görünür", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: /yeni tedarikçi/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  // ── Validation ────────────────────────────────────────────────────────────

  test("boş form gönderilince 'Tedarikçi adı zorunlu' hatası", async ({ page }) => {
    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    await page.getByRole("button", { name: /kaydet/i }).click();
    await expect(page.getByText("Tedarikçi adı zorunlu")).toBeVisible({ timeout: 3_000 });
  });

  test("geçersiz XML URL → 'Geçerli bir URL girin' hatası", async ({ page }) => {
    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    await page.getByLabel(/tedarikçi adı/i).fill("Test Tedarikci");
    await page.locator("input[type='url']").fill("bu-bir-url-degil");
    await page.getByRole("button", { name: /kaydet/i }).click();

    await expect(page.getByText(/geçerli bir url girin/i)).toBeVisible({ timeout: 3_000 });
  });

  test("XML URL boşsa 'XML URL zorunlu' hatası", async ({ page }) => {
    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    await page.getByLabel(/tedarikçi adı/i).fill("Test Tedarikci");
    // xmlUrl boş bırak
    await page.getByRole("button", { name: /kaydet/i }).click();

    await expect(page.getByText(/xml url zorunlu/i)).toBeVisible({ timeout: 3_000 });
  });

  // ── Pazaryeri checkbox ───────────────────────────────────────────────────

  test("Trendyol checkbox toggle çalışır", async ({ page }) => {
    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    const trendyolLabel = page.locator("label").filter({ hasText: /trendyol/i });
    const trendyolCheckbox = trendyolLabel.locator("input[type='checkbox']");

    // Başlangıçta işaretli değil
    await expect(trendyolCheckbox).not.toBeChecked();

    // Tıkla — işaretli olmalı
    await trendyolLabel.click();
    await expect(trendyolCheckbox).toBeChecked();

    // Tekrar tıkla — işaretsiz olmalı
    await trendyolLabel.click();
    await expect(trendyolCheckbox).not.toBeChecked();
  });

  test("Hepsiburada checkbox toggle çalışır", async ({ page }) => {
    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    const hepsiLabel = page.locator("label").filter({ hasText: /hepsiburada/i });
    const hepsiCheckbox = hepsiLabel.locator("input[type='checkbox']");

    await hepsiLabel.click();
    await expect(hepsiCheckbox).toBeChecked();
  });

  // ── Basic auth alanları ──────────────────────────────────────────────────

  test("Basic auth seçilince kullanıcı adı ve şifre alanları görünür", async ({ page }) => {
    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    await page.getByRole("radio", { name: /basic/i }).check();

    await expect(page.getByLabel(/kullanıcı adı/i)).toBeVisible();
    await expect(page.getByLabel(/şifre/i)).toBeVisible();
  });

  test("Basic auth seçilince kullanıcı adı boş → 'Kullanıcı adı zorunlu' hatası", async ({ page }) => {
    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    await page.getByLabel(/tedarikçi adı/i).fill("Test Tedarikci");
    await page.locator("input[type='url']").fill("https://feed.example.com/products.xml");
    await page.getByRole("radio", { name: /basic/i }).check();
    // kullanıcı adı boş bırak
    await page.getByRole("button", { name: /kaydet/i }).click();

    await expect(page.getByText(/kullanıcı adı zorunlu/i)).toBeVisible({ timeout: 3_000 });
  });

  // ── Başarılı submit ──────────────────────────────────────────────────────

  test("geçerli form submit → POST isteği atılır ve 'Tedarikçi oluşturuldu' toast görünür", async ({ page }) => {
    // POST mock
    await page.route(SUPPLIERS_ENDPOINT, async (route) => {
      const method = route.request().method();
      if (method === "POST") {
        const body = JSON.parse(route.request().postData() ?? "{}");
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            id: "supplier-new-001",
            name: body.name,
            xmlUrl: body.xmlUrl,
            isActive: true,
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20 }),
        });
      }
    });

    await page.getByRole("heading", { name: /yeni tedarikçi/i }).waitFor({ timeout: 8_000 });

    await page.getByLabel(/tedarikçi adı/i).fill("Yeni Test Tedarikci");
    await page.locator("input[type='url']").fill("https://feed.example.com/products.xml");

    await page.getByRole("button", { name: /kaydet/i }).click();

    await expect(page.getByText(/tedarikçi oluşturuldu/i)).toBeVisible({ timeout: 5_000 });
  });
});
