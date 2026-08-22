import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Your Feed", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // Wait for JS bundles to load and Vue to hydrate. setupWatchers() runs in
    // onMounted (client-only) — clicking seg/fchip buttons before hydration
    // loses the event because handlers aren't attached yet.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  });

  test("shows feed items", async ({ page }) => {
    // The dashboard renders items from the real API. "E2E Article One" is seeded
    // in e2e/seed.ts and must be visible when the feed-items API returns data.
    await expect(page.getByText("E2E Article One")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("filter chips are visible", async ({ page }) => {
    await expect(page.locator(".fchip").first()).toBeVisible();
  });

  test("unread-only toggle changes displayed items", async ({ page }) => {
    const chip = page.locator(".fchip").first();
    await chip.click();
    // After toggling, the chip becomes active
    await expect(chip).toHaveClass(/active/);
    // Toggle back
    await chip.click();
    await expect(chip).not.toHaveClass(/active/);
  });

  test("can switch layout to grid", async ({ page }) => {
    const feed = page.locator(".feed");
    // Default is timeline
    await expect(feed).toHaveClass(/layout-timeline/);

    // Click the second seg button (grid)
    await page.locator(".seg button").nth(1).click();
    await expect(feed).toHaveClass(/layout-grid/);
  });

  test("can switch layout to columns", async ({ page }) => {
    await page.locator(".seg button").nth(2).click();
    await expect(page.locator(".feed")).toHaveClass(/layout-columns/);
  });

  test("Saved filter returns saved items from the server, not just the loaded page", async ({
    page,
  }) => {
    // Both seeded items load under "All". The saved item (Article One) is saved
    // server-side; the starred item (Article Two) is not, so switching to Saved
    // must fetch the filtered set and drop the non-saved item.
    await expect(page.getByText("E2E Article One")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("E2E Article Two")).toBeVisible();

    await page.locator(".filters .fchip", { hasText: "Saved" }).click();

    await expect(page.getByText("E2E Article One")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("E2E Article Two")).toBeHidden();
  });

  test("Starred filter returns starred items from the server", async ({
    page,
  }) => {
    await expect(page.getByText("E2E Article Two")).toBeVisible({
      timeout: 10_000,
    });

    await page.locator(".filters .fchip", { hasText: "Starred" }).click();

    await expect(page.getByText("E2E Article Two")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText("E2E Article One")).toBeHidden();
  });
});
