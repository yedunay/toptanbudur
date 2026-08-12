/**
 * G5 Accessibility — Frontend (müşteri paneli)
 *
 * @axe-core/playwright ile /hesabim/profil critical violations = 0.
 * Auth mock ile backend gerektirmez.
 */

import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { injectCustomerAuth } from "./helpers/auth";

const PROFILE_ENDPOINT = /\/api\/customers\/me/;

const mockProfile = {
  id: "test-customer-001",
  email: "test@example.com",
  name: "Test Kullanicisi",
  firstName: "Test",
  lastName: "Kullanicisi",
  phone: "+90 500 000 00 00",
};

test.describe("Frontend a11y: /hesabim/profil", () => {
  test.beforeEach(async ({ page }) => {
    await injectCustomerAuth(page);

    await page.route(PROFILE_ENDPOINT, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ customer: mockProfile }),
      });
    });
  });

  test("/hesabim/profil: axe critical violations = 0", async ({ page }) => {
    await page.goto("/hesabim/profil", { waitUntil: "networkidle" });

    // Sayfa yüklenene dek bekle
    await page.getByRole("heading", { name: /profil bilgilerim/i }).waitFor({ timeout: 8_000 });

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
      console.error("A11y ihlaller [/hesabim/profil]:", JSON.stringify(report, null, 2));
    }

    expect(critical, "Critical violations on /hesabim/profil").toHaveLength(0);
    expect(serious, "Serious violations on /hesabim/profil").toHaveLength(0);
  });

  test("/hesabim/profil: form alanları keyboard ile gezilebilir", async ({ page }) => {
    await page.goto("/hesabim/profil", { waitUntil: "networkidle" });
    await page.getByLabel("Ad").waitFor({ state: "visible", timeout: 8_000 });

    // Ad alanına focus
    await page.getByLabel("Ad").focus();
    const focusedElements: string[] = [];

    for (let i = 0; i < 8; i++) {
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const tag = el.tagName.toLowerCase();
        const type = el.getAttribute("type") ?? "";
        const name = el.getAttribute("name") ?? el.getAttribute("aria-label") ?? "";
        return `${tag}[${type}][${name}]`;
      });
      if (focused) focusedElements.push(focused);
      await page.keyboard.press("Tab");
    }

    expect(focusedElements.length).toBeGreaterThan(3);
  });

  test("/hesabim/profil: 'Kaydet' butonu focus edilebilir", async ({ page }) => {
    await page.goto("/hesabim/profil", { waitUntil: "networkidle" });
    await page.getByLabel("Ad").waitFor({ state: "visible", timeout: 8_000 });

    const saveBtn = page.getByRole("button", { name: /kaydet/i });
    await saveBtn.focus();
    const isFocused = await saveBtn.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);
  });
});
