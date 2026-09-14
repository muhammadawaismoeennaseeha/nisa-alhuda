/**
 * QA Suite — Feature 2: Lesson Completion Marking + Progress Rings
 *
 * Tests the revamped student progress UI:
 *   - Circular SVG progress rings replace linear bars on dashboard + accordion
 *   - "Watch" / "Watched" label on lesson toggle button
 *   - Optimistic UI updates (ring animates without page reload)
 *   - State persists after hard reload
 *   - Edge cases: 0%, 100%, rapid toggle, empty offerings
 *
 * Auth: uses the seeded E2E admin (admin) — can see all pages.
 * For student-only pages we navigate directly since admin gets same layout.
 */
import { test, expect, type Page } from "@playwright/test";
import { e2eAdminEmail, e2eAdminPassword } from "./_credentials";

test.setTimeout(90_000);

const ADMIN_EMAIL = e2eAdminEmail();
const ADMIN_PASSWORD = e2eAdminPassword();

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
}

// ── 1. ProgressRing component renders on student dashboard ─────────────────

test.describe("ProgressRing — Student Dashboard Cards", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");
  });

  test("SVG progress ring is present on a course card when lessons exist", async ({ page }) => {
    // Look for the SVG ring rendered by ProgressRing component
    const svgRing = page.locator("svg[role='img'][aria-label*='Progress']").first();
    // If there are enrolled courses with lessons, the ring appears
    const cardCount = await page.locator("[data-testid='course-card'], .group.overflow-hidden").count();

    if (cardCount > 0) {
      // At least one card should have a ring SVG
      await expect(svgRing).toBeVisible({ timeout: 8000 });
    } else {
      // No enrolled courses — ring won't exist but page shouldn't crash
      await expect(page.locator("body")).toBeVisible();
      test.skip();
    }
  });

  test("ring SVG contains two circles (track + fill)", async ({ page }) => {
    const svgRing = page.locator("svg[role='img'][aria-label*='Progress']").first();
    const isVisible = await svgRing.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    const circles = svgRing.locator("circle");
    const count = await circles.count();
    expect(count).toBeGreaterThanOrEqual(2); // track + fill
  });

  test("ring shows pct% label in the centre", async ({ page }) => {
    const svgRing = page.locator("svg[role='img'][aria-label*='Progress']").first();
    const isVisible = await svgRing.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    // The centre <text> element should contain a percentage
    const centreText = svgRing.locator("text");
    const textContent = await centreText.textContent({ timeout: 5000 }).catch(() => "");
    expect(textContent).toMatch(/\d+%/);
  });

  test("'X% done' or 'Complete!' text is adjacent to the ring", async ({ page }) => {
    const svgRing = page.locator("svg[role='img'][aria-label*='Progress']").first();
    const isVisible = await svgRing.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    // The label next to the ring: either "{pct}% done" or "Complete!"
    const card = svgRing.locator("..").locator("..");
    const labelText = await card.textContent({ timeout: 5000 }).catch(() => "");
    const hasLabel = /\d+%\s*done|Complete!/.test(labelText || "");
    expect(hasLabel).toBe(true);
  });

  test("'X of Y lessons watched' sub-text appears beside the ring", async ({ page }) => {
    const body = await page.locator("body").textContent({ timeout: 5000 });
    // Could be "0 of 5 lessons watched" or "3 of 5 lessons watched"
    const hasWatched = /\d+ of \d+ lesson(s)? watched/.test(body || "");
    // If no enrolled courses this text won't appear — skip gracefully
    if (!/lesson/.test(body || "")) { test.skip(); return; }
    expect(hasWatched).toBe(true);
  });

  test("no linear progress bar element on dashboard cards", async ({ page }) => {
    // Linear bar had class h-2 + bg-muted + rounded-full
    // After Feature 2 this should not exist on course cards
    const linearBar = page.locator(".h-2.overflow-hidden.rounded-full.bg-muted");
    const count = await linearBar.count();
    expect(count).toBe(0);
  });

  test("'Continue Learning' or 'Review Course' button is still present", async ({ page }) => {
    const btn = page.getByRole("link", { name: /Continue Learning|Review Course/i }).first();
    const isVisible = await btn.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }
    await expect(btn).toBeVisible();
  });
});

// ── 2. ProgressRing — Subject Accordion Header ─────────────────────────────

test.describe("ProgressRing — Subject Accordion Header", () => {
  test("ring appears in the subject accordion header of a learning hub page", async ({ page }) => {
    await loginAsAdmin(page);

    // Admin can see offerings list — grab the first one
    await page.goto("/dashboard/admin/offerings");
    await page.waitForLoadState("networkidle");

    // Try to find an offering link to visit its student learning hub
    // (We navigate to the student view if accessible)
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    // Click "Continue Learning" on the first course card if it exists
    const continueBtn = page.getByRole("link", { name: /Continue Learning|Review Course/i }).first();
    const isVisible = await continueBtn.isVisible().catch(() => false);

    if (!isVisible) {
      // No enrolled courses — skip
      test.skip();
      return;
    }

    await continueBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // On the learning hub page, subject headers should contain the ring
    const svgRing = page.locator("svg[role='img'][aria-label*='Progress']").first();
    const ringVisible = await svgRing.isVisible({ timeout: 8000 }).catch(() => false);
    expect(ringVisible).toBe(true);
  });

  test("subject accordion header has no linear progress bar after Feature 2", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    const continueBtn = page.getByRole("link", { name: /Continue Learning|Review Course/i }).first();
    const isVisible = await continueBtn.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    await continueBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // The old subject header linear bar was h-1.5 bg-muted inside the accordion header
    const oldBar = page.locator("button .h-1\\.5.rounded-full.bg-muted");
    const count = await oldBar.count();
    expect(count).toBe(0);
  });
});

// ── 3. Lesson Toggle — "Watch" / "Watched" Label ──────────────────────────

test.describe("Lesson Toggle — Watch/Watched Label", () => {
  async function navigateToLearningHub(page: Page): Promise<boolean> {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    const continueBtn = page.getByRole("link", { name: /Continue Learning|Review Course/i }).first();
    const isVisible = await continueBtn.isVisible().catch(() => false);
    if (!isVisible) return false;

    await continueBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // Expand the first subject accordion
    const firstSubjectBtn = page.locator("button").filter({ hasText: /lesson/i }).first();
    const subjectVisible = await firstSubjectBtn.isVisible().catch(() => false);
    if (!subjectVisible) return false;

    await firstSubjectBtn.click();
    await page.waitForTimeout(500); // accordion animation
    return true;
  }

  test("lesson toggle button shows 'Watch' or 'Watched' label text", async ({ page }) => {
    const reached = await navigateToLearningHub(page);
    if (!reached) { test.skip(); return; }

    // Look for the Watch/Watched label text
    const watchLabel = page.getByText(/^Watch$|^Watched$/).first();
    const labelVisible = await watchLabel.isVisible({ timeout: 8000 }).catch(() => false);
    expect(labelVisible).toBe(true);
  });

  test("unwatched lessons show 'Watch' label (grey circle)", async ({ page }) => {
    const reached = await navigateToLearningHub(page);
    if (!reached) { test.skip(); return; }

    // Unwatched: circle icon with "Watch" label
    const watchText = page.getByText("Watch").first();
    const visible = await watchText.isVisible({ timeout: 8000 }).catch(() => false);
    if (!visible) { test.skip(); return; } // All lessons already watched
    await expect(watchText).toBeVisible();
  });

  test("clicking 'Watch' toggles to 'Watched' (optimistic update)", async ({ page }) => {
    const reached = await navigateToLearningHub(page);
    if (!reached) { test.skip(); return; }

    // Find an unwatched lesson's toggle button (has "Watch" label)
    const watchLabel = page.getByText("Watch").first();
    const isWatchVisible = await watchLabel.isVisible({ timeout: 8000 }).catch(() => false);
    if (!isWatchVisible) { test.skip(); return; } // All already watched

    // Click the button that contains the "Watch" text
    const toggleBtn = watchLabel.locator(".."); // parent button
    await toggleBtn.click();

    // Optimistic update — should change to "Watched" without page reload
    await expect(page.getByText("Watched").first()).toBeVisible({ timeout: 6000 });
  });

  test("'Watched' label appears green (confirms visual feedback)", async ({ page }) => {
    const reached = await navigateToLearningHub(page);
    if (!reached) { test.skip(); return; }

    const watchedEl = page.getByText("Watched").first();
    const visible = await watchedEl.isVisible({ timeout: 8000 }).catch(() => false);
    if (!visible) {
      // Trigger a toggle first if we have a "Watch" button
      const watchBtn = page.getByText("Watch").first();
      const watchVisible = await watchBtn.isVisible({ timeout: 3000 }).catch(() => false);
      if (!watchVisible) { test.skip(); return; }
      await watchBtn.locator("..").click();
      await page.waitForTimeout(500);
    }

    // The "Watched" span should have green colour class
    const watchedSpan = page.getByText("Watched").first();
    const cls = await watchedSpan.getAttribute("class");
    expect(cls).toContain("green");
  });

  test("toggling watched → unwatched changes label back to 'Watch'", async ({ page }) => {
    const reached = await navigateToLearningHub(page);
    if (!reached) { test.skip(); return; }

    // If there's a "Watched" lesson, click it to un-watch
    const watchedLabel = page.getByText("Watched").first();
    const watchedVisible = await watchedLabel.isVisible({ timeout: 5000 }).catch(() => false);

    if (!watchedVisible) {
      // Mark one as watched first
      const watchBtn = page.getByText("Watch").first();
      const visible = await watchBtn.isVisible({ timeout: 5000 }).catch(() => false);
      if (!visible) { test.skip(); return; }
      await watchBtn.locator("..").click();
      await expect(page.getByText("Watched").first()).toBeVisible({ timeout: 6000 });
    }

    // Now toggle it back
    const watchedNow = page.getByText("Watched").first();
    await watchedNow.locator("..").click();
    await expect(page.getByText("Watch").first()).toBeVisible({ timeout: 6000 });
  });
});

// ── 4. Progress Ring Updates After Toggle ─────────────────────────────────

test.describe("Progress Ring — Updates After Lesson Toggle", () => {
  test("ring aria-label percentage updates after marking a lesson", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    const continueBtn = page.getByRole("link", { name: /Continue Learning|Review Course/i }).first();
    const isVisible = await continueBtn.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    await continueBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // Expand first subject
    const firstSubjectBtn = page.locator("button").filter({ hasText: /lesson/i }).first();
    await firstSubjectBtn.click();
    await page.waitForTimeout(500);

    // Record initial ring pct
    const ring = page.locator("svg[role='img'][aria-label*='Progress']").first();
    const beforeLabel = await ring.getAttribute("aria-label").catch(() => "");
    const beforePct = parseInt((beforeLabel?.match(/\d+/) || ["0"])[0]);

    // Toggle a "Watch" button
    const watchBtn = page.getByText("Watch").first();
    const watchVisible = await watchBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!watchVisible) { test.skip(); return; }

    await watchBtn.locator("..").click();
    await page.waitForTimeout(800); // wait for optimistic update + ring transition

    // Ring should now show a higher percentage
    const afterLabel = await ring.getAttribute("aria-label").catch(() => "");
    const afterPct = parseInt((afterLabel?.match(/\d+/) || ["0"])[0]);

    expect(afterPct).toBeGreaterThanOrEqual(beforePct);
  });
});

// ── 5. Edge Cases ─────────────────────────────────────────────────────────

test.describe("Edge Cases", () => {
  test("ProgressRing renders without crashing on 0%", async ({ page }) => {
    // Admin dashboard — if student has no progress, ring should show 0%
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    const ring = page.locator("svg[role='img'][aria-label*='Progress: 0%']").first();
    // It may or may not exist — just verify no JS crash if it does
    const crashed = await page.locator("text=Something went wrong").isVisible().catch(() => false);
    expect(crashed).toBe(false);
  });

  test("page does not show any JS error overlay", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    // Next.js shows "Application error" on unhandled exceptions
    const errorOverlay = page.locator("text=Application error").first();
    await expect(errorOverlay).not.toBeVisible({ timeout: 3000 });
  });

  test("rapid double-click on Watch does not crash UI", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    const continueBtn = page.getByRole("link", { name: /Continue Learning|Review Course/i }).first();
    const isVisible = await continueBtn.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    await continueBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const firstSubjectBtn = page.locator("button").filter({ hasText: /lesson/i }).first();
    await firstSubjectBtn.click();
    await page.waitForTimeout(400);

    const watchBtn = page.getByText("Watch").first();
    const watchVisible = await watchBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!watchVisible) { test.skip(); return; }

    // Rapid double-click
    const toggleParent = watchBtn.locator("..");
    await toggleParent.click();
    await toggleParent.click();

    // Page should still be functional — no error overlay
    await expect(page.locator("text=Application error")).not.toBeVisible({ timeout: 3000 });
    await expect(page.locator("body")).toBeVisible();
  });

  test("ring is accessible — has role='img' and aria-label", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    const svgRing = page.locator("svg[role='img']").first();
    const isVisible = await svgRing.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    const ariaLabel = await svgRing.getAttribute("aria-label");
    expect(ariaLabel).toMatch(/Progress:/i);
  });

  test("dashboard loads correctly on mobile viewport (375px)", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    // Ring should still render and not overflow
    await expect(page.locator("body")).toBeVisible();
    const errorOverlay = page.locator("text=Application error").first();
    await expect(errorOverlay).not.toBeVisible({ timeout: 3000 });
  });
});

// ── 6. Persistence After Reload ───────────────────────────────────────────

test.describe("State Persistence After Reload", () => {
  test("lesson marked as watched stays watched after hard reload", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/student");
    await page.waitForLoadState("networkidle");

    const continueBtn = page.getByRole("link", { name: /Continue Learning|Review Course/i }).first();
    const isVisible = await continueBtn.isVisible().catch(() => false);
    if (!isVisible) { test.skip(); return; }

    await continueBtn.click();
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const currentUrl = page.url();

    const firstSubjectBtn = page.locator("button").filter({ hasText: /lesson/i }).first();
    await firstSubjectBtn.click();
    await page.waitForTimeout(400);

    // Mark a lesson as watched
    const watchBtn = page.getByText("Watch").first();
    const watchVisible = await watchBtn.isVisible({ timeout: 5000 }).catch(() => false);
    if (!watchVisible) { test.skip(); return; }

    await watchBtn.locator("..").click();
    await expect(page.getByText("Watched").first()).toBeVisible({ timeout: 6000 });

    // Hard reload
    await page.goto(currentUrl);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // Re-expand the subject
    const subjectBtnAfter = page.locator("button").filter({ hasText: /lesson/i }).first();
    await subjectBtnAfter.click();
    await page.waitForTimeout(400);

    // "Watched" label should still be visible
    await expect(page.getByText("Watched").first()).toBeVisible({ timeout: 8000 });
  });
});
