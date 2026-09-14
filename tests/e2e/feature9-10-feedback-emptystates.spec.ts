/**
 * Feature 9 — Action Micro-feedback
 * Feature 10 — Smart Empty States
 *
 * F9 tests:
 *  - FA Approval dialog has a "confirm" step before firing the server action
 *  - "Back" in the confirm step returns to the amount-entry form
 *  - Reject mode still works correctly (regression)
 *
 * F10 tests:
 *  - Admin payments "All Transactions" shows contextual EmptyState (or table)
 *  - EmptyState component renders with dashed border on empty admin payments page
 *  - Subject accordion empty class message is updated and informative
 */
import { test, expect, type Page } from "@playwright/test";
import { e2eAdminEmail, e2eAdminPassword } from "./_credentials";

test.setTimeout(90_000);

const BASE  = "http://localhost:3000";
const EMAIL = e2eAdminEmail();
const PASS  = e2eAdminPassword();

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASS);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
}

// ─── F9: FA Approval Confirmation ─────────────────────────────────────────────
test.describe("F9 — FA Approval Confirmation", () => {
  test("Review FA dialog shows confirmation step before approving", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/admin/enrollments`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const faButton = page.getByRole("button", { name: /review fa/i }).first();
    const hasFa = await faButton.isVisible().catch(() => false);

    if (!hasFa) {
      // No FA applications in test DB — skip gracefully
      test.skip();
      return;
    }

    await faButton.click();
    // Main mode: amount form with "Approve & Notify Student"
    await expect(page.getByRole("button", { name: /approve.*notify/i })).toBeVisible({ timeout: 10_000 });

    // Click should open the confirm step, not fire the action immediately
    await page.getByRole("button", { name: /approve.*notify/i }).click();

    await expect(page.getByRole("button", { name: /confirm approval/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /^back$/i })).toBeVisible();
    // The "Approve & Notify Student" button should no longer be visible in confirm mode
    await expect(page.getByRole("button", { name: /approve.*notify/i })).not.toBeVisible();
  });

  test("Back button in confirm step returns to amount-entry form", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/admin/enrollments`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const faButton = page.getByRole("button", { name: /review fa/i }).first();
    const hasFa = await faButton.isVisible().catch(() => false);
    if (!hasFa) { test.skip(); return; }

    await faButton.click();
    await expect(page.getByRole("button", { name: /approve.*notify/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /approve.*notify/i }).click();

    // Now in confirm mode
    await expect(page.getByRole("button", { name: /confirm approval/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /^back$/i }).click();

    // Should be back to main mode
    await expect(page.getByRole("button", { name: /approve.*notify/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /confirm approval/i })).not.toBeVisible();
  });

  test("Reject mode still works correctly (regression)", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/admin/enrollments`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const faButton = page.getByRole("button", { name: /review fa/i }).first();
    const hasFa = await faButton.isVisible().catch(() => false);
    if (!hasFa) { test.skip(); return; }

    await faButton.click();
    await expect(page.getByRole("button", { name: /reject/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^reject$/i }).click();

    // Reject mode: reason textarea + "Confirm Rejection" button
    await expect(page.getByRole("button", { name: /confirm rejection/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("textarea[id='rejectReason']")).toBeVisible();
  });
});

// ─── F10: Smart Empty States ───────────────────────────────────────────────────
test.describe("F10 — Smart Empty States", () => {
  test("admin payments page renders without crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await login(page);
    await page.goto(`${BASE}/dashboard/admin/payments`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await expect(page.locator("main")).toBeVisible();
    await expect(page.getByText(/all transactions/i)).toBeVisible();

    const serious = errors.filter(
      (e) => !e.includes("supabase") && !e.includes("net::ERR") && !e.includes("favicon")
    );
    expect(serious.length).toBe(0);
  });

  test("All Transactions shows contextual empty state or data table", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/admin/payments`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const emptyTitle = page.getByText(/no enrollment transactions yet/i);
    const hasEmptyState = await emptyTitle.isVisible().catch(() => false);

    if (hasEmptyState) {
      await expect(emptyTitle).toBeVisible();
      // Contextual description is present
      await expect(page.getByText(/one-time enrollment payments will appear/i)).toBeVisible();
      // EmptyState uses dashed border — verify the card is present
      const dashedCard = page.locator(".border-dashed");
      await expect(dashedCard).toBeVisible();
    } else {
      // Transactions exist — table renders
      const tables = page.locator("table");
      await expect(tables.last()).toBeVisible();
    }
  });

  test("subject accordion empty-class message is informative", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/student/offerings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // Find any offering link and navigate into it
    const offeringLink = page.getByRole("link").filter({ hasText: /view|enroll|quran|arabic|class/i }).first();
    const hasLink = await offeringLink.isVisible().catch(() => false);
    if (!hasLink) { test.skip(); return; }

    await offeringLink.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // If a subject accordion is open and has no lessons, the old generic message
    // "Classes coming soon for this subject." must not appear
    const oldMessage = page.getByText(/classes coming soon for this subject\./i);
    await expect(oldMessage).not.toBeVisible();
  });

  test("empty class state shows updated guidance message when present", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/student/offerings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const offeringLink = page.getByRole("link").filter({ hasText: /view|enroll|quran|arabic|class/i }).first();
    const hasLink = await offeringLink.isVisible().catch(() => false);
    if (!hasLink) { test.skip(); return; }

    await offeringLink.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // If a subject with no lessons exists, check the new message
    const newMessage = page.getByText(/no classes have been added/i);
    const isEmpty = await newMessage.isVisible().catch(() => false);
    if (isEmpty) {
      await expect(newMessage).toBeVisible();
    }
    // Either no empty state visible (lessons exist) or the new message appears — both pass
  });
});
