/**
 * G5 Accessibility — Admin SPA
 *
 * @axe-core/playwright ile kritik a11y ihlalleri 0 olmalı.
 * Auth mock ile backend gerektirmez.
 *
 * Sayfalar: /admin/login, /admin (dashboard), /admin/suppliers/new
 */

import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { injectAdminAuth } from "./helpers/auth";

const SUPPLIERS_ENDPOINT = /\/api\/suppliers/;
const APPLICATIONS_ENDPOINT = /\/api\/dealer-applications/;
const ORDERS_ENDPOINT = /\/api\/orders/;

async function mockCommonEndpoints(page: Page): Promise<void> {
  await page.route(SUPPLIERS_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20 }),
    });
  });
  await page.route(APPLICATIONS_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0 }),
    });
  });
  await page.route(ORDERS_ENDPOINT, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [], total: 0, page: 1, limit: 20 }),
    });
  });
}

// ---------------------------------------------------------------------------
// /admin/login — kimlik doğrulama sayfası
// ---------------------------------------------------------------------------

test("/admin/login: axe critical violations = 0", async ({ page }) => {
  await page.goto("/admin/login", { waitUntil: "networkidle" });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");

  if (critical.length > 0 || serious.length > 0) {
    const report = [...critical, ...serious].map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.length,
    }));
    console.error("A11y ihlaller [/admin/login]:", JSON.stringify(report, null, 2));
  }

  expect(critical, "Critical violations on /admin/login").toHaveLength(0);
  expect(serious, "Serious violations on /admin/login").toHaveLength(0);
});

// ---------------------------------------------------------------------------
// /admin (dashboard)
// ---------------------------------------------------------------------------

test("/admin dashboard: axe critical violations = 0", async ({ page }) => {
  await injectAdminAuth(page);
  await mockCommonEndpoints(page);

  await page.goto("/admin/", { waitUntil: "networkidle" });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");

  if (critical.length > 0 || serious.length > 0) {
    const report = [...critical, ...serious].map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.length,
    }));
    console.error("A11y ihlaller [/admin/]:", JSON.stringify(report, null, 2));
  }

  expect(critical, "Critical violations on /admin dashboard").toHaveLength(0);
  expect(serious, "Serious violations on /admin dashboard").toHaveLength(0);
});

// ---------------------------------------------------------------------------
// /admin/suppliers/new
// ---------------------------------------------------------------------------

test("/admin/suppliers/new: axe critical violations = 0", async ({ page }) => {
  await injectAdminAuth(page);
  await mockCommonEndpoints(page);

  await page.goto("/admin/suppliers/new", { waitUntil: "networkidle" });

  // Sayfa yüklenene bekle
  await page
    .getByRole("heading", { name: /yeni tedarikçi/i })
    .waitFor({ timeout: 8_000 });

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");

  if (critical.length > 0 || serious.length > 0) {
    const report = [...critical, ...serious].map((v) => ({
      id: v.id,
      impact: v.impact,
      description: v.description,
      nodes: v.nodes.length,
    }));
    console.error("A11y ihlaller [/admin/suppliers/new]:", JSON.stringify(report, null, 2));
  }

  expect(critical, "Critical violations on /admin/suppliers/new").toHaveLength(0);
  expect(serious, "Serious violations on /admin/suppliers/new").toHaveLength(0);
});

// ---------------------------------------------------------------------------
// Keyboard nav: /admin/login formu
// ---------------------------------------------------------------------------

test("/admin/login: form keyboard ile tamamlanabilir", async ({ page }) => {
  await page.goto("/admin/login", { waitUntil: "networkidle" });

  // E-posta/kullanıcı adı alanı
  const emailInput = page.locator("input[type='email'], input[type='text']").first();
  await emailInput.focus();
  await emailInput.fill("admin@example.com");

  // Tab → şifre
  await page.keyboard.press("Tab");
  await page.keyboard.type("sifre123");

  // Tab → buton
  await page.keyboard.press("Tab");

  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? el.tagName.toLowerCase() : "";
  });

  expect(["button", "input"]).toContain(focused);
});

// ---------------------------------------------------------------------------
// Supplier form: Tab order
// ---------------------------------------------------------------------------

test("/admin/suppliers/new: form alanları tab ile gezilebilir", async ({ page }) => {
  await injectAdminAuth(page);
  await mockCommonEndpoints(page);

  await page.goto("/admin/suppliers/new", { waitUntil: "networkidle" });
  await page
    .getByRole("heading", { name: /yeni tedarikçi/i })
    .waitFor({ timeout: 8_000 });

  // İlk input'a focus
  await page.getByLabel(/tedarikçi adı/i).focus();

  const focusedElements: string[] = [];
  for (let i = 0; i < 10; i++) {
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return el.tagName.toLowerCase() + (el.getAttribute("type") ? `[${el.getAttribute("type")}]` : "");
    });
    if (focused) focusedElements.push(focused);
    await page.keyboard.press("Tab");
  }

  expect(focusedElements.length).toBeGreaterThan(4);
});
