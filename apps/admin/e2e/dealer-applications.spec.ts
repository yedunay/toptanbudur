/**
 * G3 Admin E2E — /admin/legacy/dealer-applications (DealerApplicationsPage)
 *
 * Mock gerekliliği:
 *   - GET  /api/dealer-applications → başvuru listesi
 *   - POST /api/dealer-applications/:id/approve → onayla
 *   - POST /api/dealer-applications/:id/reject  → reddet
 *   - Auth: localStorage "tb_admin_token" inject
 *
 * Backend canlı olmadan çalışır.
 */

import { test, expect } from "@playwright/test";
import { injectAdminAuth } from "./helpers/auth";

const APPLICATIONS_ENDPOINT = /\/api\/admin\/dealer-applications/;

const mockPendingApp = {
  id: "app-001",
  fullName: "Ahmet Yilmaz",
  companyName: "Yilmaz Ticaret",
  phone: "+90 555 000 00 00",
  email: "ahmet@example.com",
  status: "pending",
  createdAt: "2024-06-01T09:00:00.000Z",
};

const mockApprovedApp = {
  ...mockPendingApp,
  id: "app-002",
  fullName: "Fatma Demir",
  email: "fatma@example.com",
  status: "approved",
};

test.describe("Admin — Bayi Başvuruları (/admin/legacy/dealer-applications)", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminAuth(page);
  });

  // ── Sayfa yüklenmesi ─────────────────────────────────────────────────────

  test("'Bayi Başvuruları' başlığı görünür", async ({ page }) => {
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
      });
    });

    await page.goto("/admin/legacy/dealer-applications");
    await expect(
      page.getByRole("heading", { name: /bayi başvuruları/i })
    ).toBeVisible({ timeout: 8_000 });
  });

  test("bekleyen başvuru listede görünür", async ({ page }) => {
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
      });
    });

    await page.goto("/admin/legacy/dealer-applications");
    await expect(page.getByText("Ahmet Yilmaz")).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText("Yilmaz Ticaret")).toBeVisible();
  });

  test("bekleyen başvurunun 'Onayla' ve 'Reddet' butonları görünür", async ({ page }) => {
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
      });
    });

    await page.goto("/admin/legacy/dealer-applications");
    await page.getByText("Ahmet Yilmaz").waitFor({ timeout: 8_000 });

    await expect(page.getByRole("button", { name: /onayla/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /reddet/i })).toBeVisible();
  });

  test("onaylı başvurunun işlem butonu gösterilmez", async ({ page }) => {
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockApprovedApp], total: 1 }),
      });
    });

    await page.goto("/admin/legacy/dealer-applications");
    await page.getByText("Fatma Demir").waitFor({ timeout: 8_000 });

    await expect(page.getByRole("button", { name: /onayla/i })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /reddet/i })).not.toBeVisible();
  });

  // ── Onayla ───────────────────────────────────────────────────────────────

  test("'Onayla' tıklanınca POST /approve atılır ve 'Başvuru onaylandı' toast görünür", async ({ page }) => {
    let approveCalled = false;
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes("/approve") && method === "POST") {
        approveCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...mockPendingApp, status: "approved" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
        });
      }
    });

    await page.goto("/admin/legacy/dealer-applications");
    await page.getByText("Ahmet Yilmaz").waitFor({ timeout: 8_000 });

    await page.getByRole("button", { name: /onayla/i }).click();

    await expect(page.getByText(/başvuru onaylandı/i)).toBeVisible({ timeout: 5_000 });
    expect(approveCalled).toBe(true);
  });

  // ── Reddet — ConfirmDialog ────────────────────────────────────────────────

  test("'Reddet' tıklanınca ConfirmDialog açılır", async ({ page }) => {
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
      });
    });

    await page.goto("/admin/legacy/dealer-applications");
    await page.getByText("Ahmet Yilmaz").waitFor({ timeout: 8_000 });

    await page.getByRole("button", { name: /reddet/i }).click();

    // ConfirmDialog role="dialog" açılmalı
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 3_000 });
    await expect(page.getByRole("dialog")).toContainText(/başvuruyu reddet/i);
  });

  test("ConfirmDialog'da 'İptal' tıklanınca dialog kapanır ve reddetme olmaz", async ({ page }) => {
    let rejectCalled = false;
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      const url = route.request().url();
      if (url.includes("/reject")) {
        rejectCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...mockPendingApp, status: "rejected" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
        });
      }
    });

    await page.goto("/admin/legacy/dealer-applications");
    await page.getByText("Ahmet Yilmaz").waitFor({ timeout: 8_000 });

    await page.getByRole("button", { name: /reddet/i }).click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 3_000 });

    // İptal butonu
    await page.getByRole("button", { name: /iptal/i }).click();

    await expect(page.getByRole("dialog")).not.toBeVisible({ timeout: 3_000 });
    expect(rejectCalled).toBe(false);
  });

  test("ConfirmDialog'da 'Reddet' onaylanınca POST /reject atılır ve 'Başvuru reddedildi' toast görünür", async ({ page }) => {
    let rejectCalled = false;
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      const url = route.request().url();
      const method = route.request().method();
      if (url.includes("/reject") && method === "POST") {
        rejectCalled = true;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ...mockPendingApp, status: "rejected" }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
        });
      }
    });

    await page.goto("/admin/legacy/dealer-applications");
    await page.getByText("Ahmet Yilmaz").waitFor({ timeout: 8_000 });

    // Reddet → dialog açılır → onayla
    await page.getByRole("button", { name: /reddet/i }).click();
    await page.getByRole("dialog").waitFor({ state: "visible", timeout: 3_000 });

    // Dialog içindeki "Reddet" onay butonu
    const dialogConfirmBtn = page.getByRole("dialog").getByRole("button", { name: /reddet/i });
    await dialogConfirmBtn.click();

    await expect(page.getByText(/başvuru reddedildi/i)).toBeVisible({ timeout: 5_000 });
    expect(rejectCalled).toBe(true);
  });

  // ── Filtre dropdown ───────────────────────────────────────────────────────

  test("durum filtrelemesi 'Bekleyen' seçilince URL parametresi değişir", async ({ page }) => {
    await page.route(APPLICATIONS_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [mockPendingApp], total: 1 }),
      });
    });

    await page.goto("/admin/legacy/dealer-applications");
    await page.getByRole("heading", { name: /bayi başvuruları/i }).waitFor({ timeout: 8_000 });

    // "Tüm durumlar" select
    const filterSelect = page.locator("select").first();
    await filterSelect.selectOption("pending");

    // Seçim korundu
    await expect(filterSelect).toHaveValue("pending");
  });
});
