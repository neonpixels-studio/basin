import { test, expect, type Page } from "@playwright/test";

const SEARCH_INPUT = "#reader-search-input";

// Opens the overlay via the real keyboard shortcut (app.vue's isCmdK handler)
// and confirms the input actually receives focus, matching useSearch's
// openSearch() behavior rather than just checking the overlay is in the DOM.
async function openSearchOverlay(page: Page) {
  await page.keyboard.press("Control+k");
  await expect(page.locator(".search-scrim")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(SEARCH_INPUT)).toBeFocused();
}

// Matches the real /api/search page-object contract (server/utils/search.ts's
// SearchPage), not a bare array, so a route mock can't accidentally exercise
// the "old contract" error path the component guards against.
function searchPageBody(
  items: Array<Record<string, unknown>>,
  nextOffset: number | null = null,
) {
  return JSON.stringify({ items, nextOffset });
}

function mockSearchResult(id: number, title: string) {
  return {
    id,
    feedId: 1,
    guid: `mock-search-${id}`,
    type: "article",
    source: "Mock Feed",
    time: "1h",
    title,
    url: `https://example.com/${id}`,
    author: null,
    imageUrl: null,
    content: null,
    tags: null,
    publishedAt: null,
    readAt: new Date().toISOString(),
    starred: false,
    savedAt: null,
    createdAt: null,
    updatedAt: null,
    unread: false,
  };
}

test.describe("Global search", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Your Feed", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    // Same rationale as dashboard.spec.ts: wait for hydration + the initial
    // feed load before dispatching keyboard events at the window listener.
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  });

  test("opens the overlay via the Ctrl/Cmd+K shortcut", async ({ page }) => {
    await openSearchOverlay(page);
    await expect(page.locator(".search-modal")).toBeVisible();
  });

  test("debounces the search request, firing once after typing stops", async ({
    page,
  }) => {
    const requestedQueries: string[] = [];
    await page.route("**/api/search**", async (route) => {
      const url = new URL(route.request().url());
      requestedQueries.push(url.searchParams.get("q") ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: searchPageBody([]),
      });
    });

    await openSearchOverlay(page);
    // Each keystroke fires the v-model watcher; typed well under the 300ms
    // debounce so only the final value should ever reach /api/search.
    await page.locator(SEARCH_INPUT).pressSequentially("abc", { delay: 40 });

    await expect
      .poll(() => requestedQueries.length, { timeout: 5_000 })
      .toBe(1);
    expect(requestedQueries[0]).toBe("abc");
  });

  test("cancels a stale in-flight request when the query changes (AbortController)", async ({
    page,
  }) => {
    await page.route("**/api/search**", async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get("q");
      if (query === "first") {
        // Held open well past the second query's response so a real race
        // exists: without the AbortController cancellation this stale
        // response would land after "second" already rendered.
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        try {
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: searchPageBody([mockSearchResult(1, "Stale first result")]),
          });
        } catch {
          // The browser already aborted the underlying request — expected
          // once fulfill races against fetchSearchResults' cancelPendingSearch.
        }
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: searchPageBody([mockSearchResult(2, "Fresh second result")]),
      });
    });

    await openSearchOverlay(page);
    await page.locator(SEARCH_INPUT).fill("first");
    // Confirm the debounced request for "first" is actually in flight before
    // superseding it — otherwise this would only prove the debounce coalesces
    // keystrokes, not that a live request gets aborted.
    await page.waitForRequest((request) => request.url().includes("q=first"), {
      timeout: 5_000,
    });

    await page.locator(SEARCH_INPUT).fill("second");
    await expect(page.getByText("Fresh second result")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Stale first result")).toHaveCount(0);
  });

  test("moves the highlighted row with the arrow keys", async ({ page }) => {
    await openSearchOverlay(page);
    const cursorTitle = () =>
      page.locator(".sr-item.cursor .sr-title").innerText();

    // Pages always render first and in fixed order (Dashboard, Settings, Sign
    // in) when the query is empty, so the cursor's starting position and the
    // arrow-key destinations are deterministic regardless of recent items.
    await expect.poll(cursorTitle).toBe("Dashboard");

    await page.keyboard.press("ArrowDown");
    await expect.poll(cursorTitle).toBe("Settings");

    await page.keyboard.press("ArrowUp");
    await expect.poll(cursorTitle).toBe("Dashboard");
  });

  test("Enter navigates to the highlighted page and closes the overlay", async ({
    page,
  }) => {
    await openSearchOverlay(page);
    await page.keyboard.press("ArrowDown");
    await expect(page.locator(".sr-item.cursor .sr-title")).toHaveText(
      "Settings",
    );

    await page.keyboard.press("Enter");

    // settings/index.vue redirects to settings/feeds; landing there and
    // seeing its content confirms navigateTo() actually fired, not just that
    // the overlay closed.
    await expect(page).toHaveURL(/\/settings\/feeds$/, { timeout: 5_000 });
    await expect(page.locator(".search-scrim")).not.toBeVisible();
  });

  test("Enter opens the highlighted search result and closes the overlay", async ({
    page,
  }) => {
    // Uses the real seeded feed items (e2e/seed.ts) and the real /api/search
    // endpoint, exercising the exact regression called out in #266/#247:
    // chooseRow() must hand a real search row to feedStore.openItem().
    await openSearchOverlay(page);
    await page.locator(SEARCH_INPUT).fill("Article");

    await expect(page.locator(".sr-group", { hasText: "Results" })).toBeVisible(
      { timeout: 5_000 },
    );
    await expect(page.locator(".sr-item").first()).toBeVisible();

    await page.keyboard.press("Enter");

    await expect(page.locator(".search-scrim")).not.toBeVisible();
    await expect(page.locator(".detail-sheet")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("shows an error state on a failed search and recovers on retry", async ({
    page,
  }) => {
    let shouldFail = true;
    await page.route("**/api/search**", async (route) => {
      if (shouldFail) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "boom" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: searchPageBody([]),
      });
    });

    await openSearchOverlay(page);
    await page.locator(SEARCH_INPUT).fill("whatever");

    await expect(page.locator(".search-error")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("Search is unavailable")).toBeVisible();

    shouldFail = false;
    await page.locator(".search-error .btn").click();

    await expect(page.locator(".search-error")).not.toBeVisible({
      timeout: 5_000,
    });
    await expect(page.getByText("No matches")).toBeVisible();
  });
});
