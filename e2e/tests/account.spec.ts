import { test, expect } from "@playwright/test";

const TEST_USER_EMAIL = "e2e-test@reader-app.dev";

// These tests run in the "chromium" project in their own isolated CI shard,
// each with a dedicated Neon branch. The logout test terminates the Clerk FAPI
// session, but since each shard is isolated that has no impact on other specs.
test.describe("Settings > Account", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/account");
    // `exact` so this doesn't also match the "Delete account" section heading.
    await expect(
      page.locator("h2").getByText("Account", { exact: true }),
    ).toBeVisible({
      timeout: 10_000,
    });
  });

  test("shows authenticated user name and email", async ({ page }) => {
    await expect(page.getByText("E2E Test")).toBeVisible();
    await expect(page.getByText(TEST_USER_EMAIL)).toBeVisible();
  });

  test("sign out button is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  // Keep this test last — it terminates the Clerk FAPI session, making the
  // stored storageState stale for any tests that run after it.
  test("can sign out then sign back in", async ({ page }) => {
    // The <h2> heading is static HTML and appears before Clerk initializes.
    // Wait for the user name (rendered via useUser()) as a reliable signal that
    // clerk.value in useClerk() is non-null — otherwise the optional-chain in
    // handleSignOut silently no-ops and the page never navigates away.
    await expect(page.getByText("E2E Test")).toBeVisible({ timeout: 8_000 });

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });

    // Sign back in via the Clerk <SignIn /> UI form
    await page.locator('input[name="identifier"]').fill(TEST_USER_EMAIL);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.locator("input[type=password]")).toBeVisible({
      timeout: 8_000,
    });
    await page.locator("input[type=password]").fill("E2eTestPass1!");
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });
});
