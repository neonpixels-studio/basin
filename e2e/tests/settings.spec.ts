import { test, expect, type Page } from "@playwright/test";

// The settings store only PATCHes when a reactive value actually changes, so a
// click on an already-active option fires no request. The timeout is generous
// because the first write to a freshly-branched CI database can be slow.
function waitForSettingSave(page: Page) {
  return page.waitForResponse(
    (resp) =>
      resp.url().includes("/api/settings/reading") &&
      resp.request().method() === "PATCH",
    { timeout: 15_000 },
  );
}

async function reloadAndWait(page: Page) {
  await page.reload();
  await page.waitForLoadState("networkidle", { timeout: 15_000 });
}

// Click a segmented-control button and wait for the save to persist. If the
// target is already active (e.g. left over from a prior CI run or a retry of
// this same test), first switch to `resetLabel` so the target click is always a
// real state change — a no-op click fires no PATCH and starves the save waiter.
async function selectSegAndPersist(
  page: Page,
  rowLabel: string,
  targetLabel: string,
  resetLabel: string,
) {
  const row = page.locator(".set-pref-row").filter({ hasText: rowLabel });
  const target = row.locator("button", { hasText: targetLabel });

  if (await target.evaluate((el) => el.classList.contains("active"))) {
    const reset = waitForSettingSave(page);
    await row.locator("button", { hasText: resetLabel }).click();
    await reset;
  }

  const save = waitForSettingSave(page);
  await target.click();
  await save;

  await reloadAndWait(page);
  await expect(target).toHaveClass(/active/);
}

async function testTogglePersists(page: Page, rowLabel: string) {
  const toggle = page
    .locator(".set-pref-row")
    .filter({ hasText: rowLabel })
    .locator(".toggle");

  const wasBefore = await toggle.evaluate((el) => el.classList.contains("on"));
  const save = waitForSettingSave(page);
  await toggle.click();
  await save;

  await reloadAndWait(page);
  if (wasBefore) {
    await expect(toggle).not.toHaveClass(/on/);
  } else {
    await expect(toggle).toHaveClass(/on/);
  }
}

test.describe("Settings > Reading", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings/reading");
    await expect(
      page.locator("h2").getByText("Reading preferences"),
    ).toBeVisible({ timeout: 10_000 });
    // Wait for Vue to hydrate and for initAppearance() to finish loading
    // settings from the DB before any test interactions.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  });

  test("theme: switching to dark persists across reload", async ({ page }) => {
    await selectSegAndPersist(page, "Theme", "Dark", "System");
  });

  test("accent color: switching to blue persists across reload", async ({
    page,
  }) => {
    const accentRow = page
      .locator(".set-pref-row")
      .filter({ hasText: "Accent color" });
    const blue = accentRow.locator('.twk-sw[title="blue"]');

    // A no-op click on the already-selected swatch fires no PATCH, so reset to
    // another accent first when blue is already on (leftover state / a retry).
    if (await blue.evaluate((el) => el.classList.contains("on"))) {
      const reset = waitForSettingSave(page);
      await accentRow.locator('.twk-sw[title="violet"]').click();
      await reset;
    }

    const save = waitForSettingSave(page);
    await blue.click();
    await save;

    await reloadAndWait(page);
    await expect(blue).toHaveClass(/on/);
  });

  test("reading font: switching to serif persists across reload", async ({
    page,
  }) => {
    await selectSegAndPersist(page, "Reading font", "Serif", "Mono");
  });

  test("spacing: switching to compact persists across reload", async ({
    page,
  }) => {
    await selectSegAndPersist(page, "Spacing", "Compact", "Cozy");
  });

  test("show unread only: toggling persists across reload", async ({
    page,
  }) => {
    await testTogglePersists(page, "Show unread only");
  });

  test("autoplay media previews: toggling persists across reload", async ({
    page,
  }) => {
    await testTogglePersists(page, "Autoplay media previews");
  });

  test("compact notifications: toggling persists across reload", async ({
    page,
  }) => {
    await testTogglePersists(page, "Compact notifications");
  });

  test("default layout: switching to grid persists across reload", async ({
    page,
  }) => {
    await selectSegAndPersist(page, "Default layout", "Grid", "Timeline");
  });
});

test.describe("Settings navigation", () => {
  test("/ redirects to /settings/feeds", async ({ page }) => {
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings\/feeds/);
  });

  test("settings sub-pages are reachable", async ({ page }) => {
    for (const path of [
      "/settings/feeds",
      "/settings/connections",
      "/settings/reading",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path));
    }
  });
});
