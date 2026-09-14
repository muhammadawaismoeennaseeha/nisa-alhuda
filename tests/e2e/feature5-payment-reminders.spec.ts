/**
 * Feature 5 — Automated Payment Reminders
 *
 * Tests the send-payment-reminders cron endpoint (auth gating + response
 * shape) and verifies that the admin/student payment UI pages load cleanly.
 *
 * The cron itself is a background job that fires once per cycle. We can't
 * manufacture actual owed rows in a Playwright test without hitting the DB,
 * so the API tests focus on correctness of the endpoint contract:
 *   - auth gating (401 without correct Bearer token)
 *   - response shape when called legitimately (200 with expected fields)
 *   - idempotency — calling twice doesn't produce duplicate log entries
 *
 * UI tests confirm the admin payment ledger and student receipt upload
 * pages load without console errors, which is the surface area that
 * integrates with the reminder flow.
 */
import { test, expect, type Page } from "@playwright/test";
import { e2eAdminEmail, e2eAdminPassword } from "./_credentials";

test.setTimeout(90_000);

const BASE         = "http://localhost:3000";
const CRON_SECRET  = "nisa-alhuda-cron-secret-2026";
const EMAIL        = e2eAdminEmail();
const PASS         = e2eAdminPassword();
const CRON_URL     = `${BASE}/api/cron/send-payment-reminders`;

async function login(page: Page) {
  await page.goto("/login");
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill(PASS);
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
}

// ─── File-level migration probe ──────────────────────────────────────────────
// Runs before ALL tests in this file. Sets migrationApplied so any group can
// gate on it. Without migration 030, correct-auth cron calls return 500 with
// "Could not find the function public.get_owed_reminder_targets".

let migrationApplied = false;

test.beforeAll(async ({ request }) => {
  const probe = await request.get(CRON_URL, {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
  const body = await probe.json().catch(() => ({}));
  migrationApplied =
    probe.status() === 200 ||
    (probe.status() === 500 &&
      !String(body?.error ?? "").includes("Could not find the function"));
});

// ─── Group 1: Cron auth gating ───────────────────────────────────────────────
test.describe("Cron — auth gating", () => {

  test("no Authorization header → 401", async ({ request }) => {
    const res = await request.get(CRON_URL);
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  test("wrong Bearer token → 401", async ({ request }) => {
    const res = await request.get(CRON_URL, {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status()).toBe(401);
  });

  test("correct Bearer token → 200 with expected shape", async ({ request }) => {
    test.skip(!migrationApplied, "Requires migration 030 — apply 030_payment_reminders.sql first");
    const res = await request.get(CRON_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("cycle");
    const hasReminded = "reminded" in body;
    const hasSkipped  = "skipped" in body;
    expect(hasReminded || hasSkipped).toBe(true);
  });

  test("correct token → ok is boolean, cycle is YYYY-MM-DD string", async ({ request }) => {
    test.skip(!migrationApplied, "Requires migration 030 — apply 030_payment_reminders.sql first");
    const res = await request.get(CRON_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const body = await res.json();
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.cycle).toBe("string");
    expect(body.cycle).toMatch(/^\d{4}-\d{2}-27$/);
  });

  test("calling twice is idempotent — second run returns reminded:0 for same cycle", async ({ request }) => {
    test.skip(!migrationApplied, "Requires migration 030 — apply 030_payment_reminders.sql first");
    const headers = { Authorization: `Bearer ${CRON_SECRET}` };
    const first = await request.get(CRON_URL, { headers });
    expect(first.status()).toBe(200);

    const second = await request.get(CRON_URL, { headers });
    expect(second.status()).toBe(200);
    const body = await second.json();
    if ("reminded" in body) {
      expect(body.reminded).toBe(0);
    } else {
      expect(body).toHaveProperty("skipped");
    }
  });
});

// ─── Group 2: Admin payment ledger ───────────────────────────────────────────
test.describe("Admin — payment ledger loads", () => {
  test("admin payments page loads without crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await login(page);
    await page.goto(`${BASE}/dashboard/admin/payments`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible();
    const serious = errors.filter(
      (e) => !e.includes("supabase") && !e.includes("net::ERR") && !e.includes("favicon")
    );
    expect(serious.length).toBe(0);
  });

  test("admin billing grid page loads", async ({ page }) => {
    await login(page);
    await page.goto(`${BASE}/dashboard/admin/payments/grid`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    const main = page.locator("main");
    await expect(main).toBeVisible();
  });
});

// ─── Group 3: Student monthly payment receipt upload page ────────────────────
test.describe("Student — monthly payment receipt page", () => {
  test("upload page loads gracefully for a non-existent enrollment ID", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
    await login(page);
    // Navigate to a fake enrollment ID — should render gracefully (not found
    // message or redirect) rather than crash with a 500.
    await page.goto(`${BASE}/dashboard/student/monthly-payment/00000000-0000-0000-0000-000000000000`);
    await page.waitForLoadState("networkidle", { timeout: 30_000 });
    // Page must not blow up — either shows an error message or redirects
    await expect(page.locator("body")).toBeVisible();
    // Main content area must be present
    await expect(page.locator("main")).toBeVisible();
    const serious = errors.filter(
      (e) => !e.includes("supabase") && !e.includes("net::ERR") && !e.includes("favicon")
    );
    expect(serious.length).toBe(0);
  });
});

// ─── Group 4: Cron endpoint robustness ───────────────────────────────────────
test.describe("Cron — response robustness", () => {
  test("responds even when there are zero owed rows", async ({ request }) => {
    test.skip(!migrationApplied, "Requires migration 030 — apply 030_payment_reminders.sql first");
    const res = await request.get(CRON_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status()).toBe(200);
  });

  test("content-type is application/json", async ({ request }) => {
    const res = await request.get(CRON_URL, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    const ct = res.headers()["content-type"] ?? "";
    expect(ct).toContain("application/json");
  });

  test("401 response body is valid JSON", async ({ request }) => {
    const res = await request.get(CRON_URL);
    const text = await res.text();
    expect(() => JSON.parse(text)).not.toThrow();
  });
});
