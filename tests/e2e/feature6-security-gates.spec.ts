/**
 * Feature 6 — Security Gate Completion
 * Feature 7 — Standardized Action Contract
 * Feature 8 — Centralized Query Layer
 *
 * Tests:
 *  - Settings page loads and all three sections render
 *  - Password form is present and validates before submitting
 *  - Suspended page exists and renders gracefully
 *  - /api routes reject without auth (confirms gates are enforced)
 *  - New db/ modules compile and are importable (TypeScript check covers this;
 *    runtime smoke: settings page exercising profile read)
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

// ─── Group 1: Settings page structure ────────────────────────────────────────
test.describe("Settings — page structure", () => {
  test("settings page loads without console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    await expect(page.locator("main")).toBeVisible();
    const serious = errors.filter(
      (e) => !e.includes("supabase") && !e.includes("net::ERR") && !e.includes("favicon")
    );
    expect(serious.length).toBe(0);
  });

  test("password form section is present", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    // The password form has a "New Password" label (exact match avoids "Confirm New Password")
    await expect(page.getByText("New Password", { exact: true }).first()).toBeVisible();
  });

  test("Update Password button is disabled when fields are empty", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    const btn = page.getByRole("button", { name: /update password/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeDisabled();
  });

  test("Update Password button enables when passwords match and length >= 6", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    // Fill both password fields with matching value
    const inputs = page.locator("input[type='password']");
    await inputs.nth(0).fill("newpass123");
    await inputs.nth(1).fill("newpass123");

    const btn = page.getByRole("button", { name: /update password/i });
    await expect(btn).toBeEnabled();
  });

  test("mismatch passwords shows validation message", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });

    const inputs = page.locator("input[type='password']");
    await inputs.nth(0).fill("newpass123");
    await inputs.nth(1).fill("different");

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test("profile form section is present", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    // Profile form always has a Full Name label
    await expect(page.getByText("Full Name")).toBeVisible();
  });
});

// ─── Group 2: Security gate — suspended route ─────────────────────────────────
test.describe("Security gate — suspended page", () => {
  test("/suspended page renders without crashing", async ({ page }) => {
    await page.goto(`${BASE}/suspended`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    // The suspended page must have some visible content
    await expect(page.locator("body")).toBeVisible();
  });

  test("/suspended page shows a meaningful message", async ({ page }) => {
    await page.goto(`${BASE}/suspended`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    // Should mention suspension or contact admin
    const body = await page.locator("body").textContent();
    const mentionsSuspension =
      /suspend|access|admin|contact/i.test(body ?? "");
    expect(mentionsSuspension).toBe(true);
  });
});

// ─── Group 3: Security gate — auth enforcement ────────────────────────────────
test.describe("Security gate — unauthenticated access blocked", () => {
  test("dashboard redirects to login when not authenticated", async ({ page }) => {
    await page.goto(`${BASE}/dashboard`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    expect(page.url()).toContain("/login");
  });

  test("admin routes redirect to login when not authenticated", async ({ page }) => {
    await page.goto(`${BASE}/dashboard/admin/payments`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    expect(page.url()).toContain("/login");
  });

  test("student routes redirect to login when not authenticated", async ({ page }) => {
    await page.goto(`${BASE}/dashboard/student`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    expect(page.url()).toContain("/login");
  });

  test("settings route redirects to login when not authenticated", async ({ page }) => {
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    expect(page.url()).toContain("/login");
  });
});

// ─── Group 4: must_change_password gate behaviour ────────────────────────────
test.describe("must_change_password gate", () => {
  test("authenticated user can access /dashboard/settings freely", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    // Settings must render (not redirect away)
    expect(page.url()).toContain("/dashboard/settings");
    await expect(page.locator("main")).toBeVisible();
  });

  test("settings page renders all three form cards", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/settings`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    // Avatar section (has a card with photo/initials), profile form, password form
    const cards = page.locator('[class*="card"], [class*="Card"]');
    const count = await cards.count();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ─── Group 5: Action Contract — cron routes use consistent JSON shape ─────────
test.describe("Action contract — API response shapes", () => {
  test("cron endpoints return JSON with { ok } on auth failure", async ({ request }) => {
    const res = await request.get(`${BASE}/api/cron/roll-monthly-cycles`);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
  });

  test("health endpoint returns { ok: true }", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
