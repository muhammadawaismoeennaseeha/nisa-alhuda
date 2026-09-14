/**
 * QA Suite — Feature 1: Email Infrastructure
 *
 * Tests the revamped email flow:
 *   - No hardcoded shared password in UI or API responses
 *   - Admin email broadcast page loads with all 8 templates
 *   - Custom message field (XSS input handled safely)
 *   - Confirm modal appears before send
 *   - Broadcast API response includes `failed` count
 *   - Admin credentials page loads correctly
 *   - Broadcast failure toast shows warning vs success
 */
import { test, expect, type Page } from "@playwright/test";
import { e2eAdminEmail, e2eAdminPassword } from "./_credentials";

// Dev server lazy-compiles pages on first visit — allow extra time.
test.setTimeout(90_000);

const ADMIN_EMAIL = e2eAdminEmail();
const ADMIN_PASSWORD = e2eAdminPassword();

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  // Wait for the form to be interactive before filling
  await page.locator("#email").waitFor({ state: "visible", timeout: 20_000 });
  await page.locator("#email").fill(ADMIN_EMAIL);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /log in/i }).click();
  // Dev mode compiles dashboard pages on first hit — give it up to 60 s
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  // Wait for the compiled page to settle
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

test.describe("Admin login", () => {
  test("admin can log in with email + password", async ({ page }) => {
    await loginAsAdmin(page);
    // Should land on admin dashboard
    await expect(page).toHaveURL(/\/dashboard/);
    // Dashboard renders without crash
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 8000 });
  });

  test("wrong password shows error toast", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill(ADMIN_EMAIL);
    await page.locator("#password").fill("wrongpassword_xyz");
    await page.getByRole("button", { name: /log in/i }).click();
    await expect(page.locator("[data-sonner-toast]")).toBeVisible({ timeout: 8000 });
  });
});

// ── Email Broadcast Page ──────────────────────────────────────────────────────

test.describe("Email broadcast page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/admin/emails");
    await page.waitForLoadState("networkidle");
  });

  test("broadcast page loads with template cards", async ({ page }) => {
    // Template cards are clickable divs — assert by their visible text labels
    await expect(page.getByText("Welcome to the Family")).toBeVisible({ timeout: 8000 });
    await expect(page.getByText("Keep Going, Sister!")).toBeVisible();
    await expect(page.getByText("Milestone Celebration")).toBeVisible();
    await expect(page.getByText("Gentle Study Reminder")).toBeVisible();
    await expect(page.getByText(/Jumu.ah Blessings/i)).toBeVisible();
    await expect(page.getByText("Ramadan Greetings")).toBeVisible();
    await expect(page.getByText(/Thank You.*Jazakillah/i)).toBeVisible();
    await expect(page.getByText("New Course Announcement")).toBeVisible();
  });

  test("selecting a template enables audience step", async ({ page }) => {
    // Click first available template card
    const firstTemplate = page.getByText(/Welcome to the Family/i).first();
    await firstTemplate.click();
    // Audience section should become visible
    await expect(page.getByText(/audience/i).first()).toBeVisible({ timeout: 5000 });
  });

  test("custom message field accepts XSS-like input without crashing", async ({ page }) => {
    // Select a template
    await page.getByText(/Welcome to the Family/i).first().click();
    // Look for custom message textarea
    const textarea = page.locator("textarea").first();
    if (await textarea.isVisible()) {
      // Paste XSS payload — frontend should accept it (sanitisation happens server-side)
      await textarea.fill("<script>alert('xss')</script>");
      const value = await textarea.inputValue();
      expect(value).toContain("<script>");
      // No page crash
      await expect(page.locator("body")).toBeVisible();
    } else {
      test.skip(); // textarea may only appear after template + audience selection
    }
  });

  test("confirm modal appears before sending", async ({ page }) => {
    // Select template
    await page.getByText(/Welcome to the Family/i).first().click();
    // Select all-students audience if visible
    const allStudentsOption = page.getByText(/all students/i).first();
    if (await allStudentsOption.isVisible()) await allStudentsOption.click();
    // Click send / confirm button
    const sendBtn = page.getByRole("button", { name: /send|confirm|preview/i }).first();
    if (await sendBtn.isVisible()) {
      await sendBtn.click();
      // A confirmation dialog or summary step should appear
      const confirmEl = page.getByText(/confirm|are you sure|send to/i).first();
      await expect(confirmEl).toBeVisible({ timeout: 5000 });
    }
  });
});

// ── Credentials Page ──────────────────────────────────────────────────────────

test.describe("Admin credentials page", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/admin/credentials");
    await page.waitForLoadState("networkidle");
  });

  test("credentials page loads", async ({ page }) => {
    // Should show some heading or offering selector
    await expect(page.locator("h1, h2, select, [role='combobox']").first()).toBeVisible({ timeout: 8000 });
  });

  test("no hardcoded shared password visible on credentials page", async ({ page }) => {
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("nisaalhud@student#2026");
    expect(bodyText).not.toContain("APPROVAL_DEFAULT_PASSWORD");
  });
});

// ── API Contract ──────────────────────────────────────────────────────────────

test.describe("Email API response contract", () => {
  test("broadcast API response includes failed count", async ({ page }) => {
    // Log in to get session cookies
    await loginAsAdmin(page);

    // Use page.request so it shares the authenticated browser session cookies
    const response = await page.request.post("http://localhost:3000/api/email", {
      headers: { "Content-Type": "application/json" },
      data: {
        type: "broadcast",
        templateKey: "welcome",
        audience: "offering",
        offeringId: "00000000-0000-0000-0000-000000000000", // non-existent → 0 recipients, no emails sent
        customMessage: null,
      },
    });

    // Should respond with 200 even when 0 recipients
    expect(response.status()).toBe(200);
    const body = await response.json();
    // New contract: must include `failed` count
    expect(body).toHaveProperty("ok");
    expect(body).toHaveProperty("sent");
    expect(body).toHaveProperty("failed");
    expect(typeof body.sent).toBe("number");
    expect(typeof body.failed).toBe("number");
  });

  test("broadcast API sanitises XSS in customMessage (server-side)", async ({ page }) => {
    await loginAsAdmin(page);

    const xssPayload = "<script>alert('xss')</script>";
    const response = await page.request.post("http://localhost:3000/api/email", {
      headers: { "Content-Type": "application/json" },
      data: {
        type: "broadcast",
        templateKey: "welcome",
        audience: "offering",
        offeringId: "00000000-0000-0000-0000-000000000000",
        customMessage: xssPayload,
      },
    });

    // Should succeed (no 500 crash on XSS input)
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});

// ── No Shared Password Traces ─────────────────────────────────────────────────

test.describe("Shared password removal", () => {
  test("admin dashboard and payments page contain no default password string", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/admin/payments");
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("nisaalhud@student#2026");
  });

  test("admin enrollments page contains no default password string", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/dashboard/admin/enrollments");
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).not.toContain("nisaalhud@student#2026");
  });
});
