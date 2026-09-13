import { test, expect, type Page } from "@playwright/test";

const SEARCH_INPUT = "#reader-search-input";

// Comfortably past SearchOverlay.vue's 300ms query debounce, used wherever a
// test needs to prove no further request arrives after the one it already saw.
const DEBOUNCE_SETTLE_MS = 600;

// Opens the overlay via the real keyboard shortcut (app.vue's isCmdK handler)
// and confirms the input actually receives focus, matching useSearch's
// openSearch() behavior rather than just checking the overlay is in the DOM.
async function openSearchOverlay(page: Page) {
  // Playwright maps this to Meta on macOS and Control everywhere else,
  // matching app.vue's isCmdK handler (`e.metaKey || e.ctrlKey`) on whichever
  // platform the test actually runs on.
  await page.keyboard.press("ControlOrMeta+k");
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
    // Wait past the debounce window once more before asserting the full
    // array: polling on the count alone would pass the instant it first hits
    // 1, even if a second (leaked) request for the same query landed right
    // after — which is exactly the debounce-leak regression this test names.
    await page.waitForTimeout(DEBOUNCE_SETTLE_MS);
    expect(requestedQueries).toEqual(["abc"]);
  });

  test("cancels a stale in-flight request when the query changes (AbortController)", async ({
    page,
  }) => {
    // Held open past the second query's response so a real race exists:
    // without the component actually calling AbortController#abort(), the
    // browser would never cancel this request on the wire, and without the
    // isSuperseded checks in fetchSearchResults a late response would go on
    // to overwrite the newer render. The route handler still attempts
    // fulfill() after the delay for either outcome — Playwright resolves that
    // call whether or not the underlying request was already aborted, so it
    // can't itself prove cancellation — the page's "requestfailed" event
    // (net::ERR_ABORTED) below is the actual signal that the browser cut the
    // request rather than merely ignoring its response.
    const STALE_HOLD_MS = 1_000;

    await page.route("**/api/search**", async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get("q");
      if (query === "first") {
        await new Promise((resolve) => setTimeout(resolve, STALE_HOLD_MS));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: searchPageBody([mockSearchResult(1, "Stale first result")]),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: searchPageBody([mockSearchResult(2, "Fresh second result")]),
      });
    });

    await openSearchOverlay(page);
    // Attach the waiter before the action that triggers it, so a slow
    // debounce can't let the request fire unobserved.
    const staleRequestSent = page.waitForRequest(
      (request) => request.url().includes("q=first"),
      { timeout: 5_000 },
    );
    await page.locator(SEARCH_INPUT).fill("first");
    // Confirm the debounced request for "first" is actually in flight before
    // superseding it — otherwise this would only prove the debounce coalesces
    // keystrokes, not that a live request gets aborted.
    await staleRequestSent;

    // Attach before the query change that triggers the cancellation.
    const staleRequestAborted = page.waitForEvent("requestfailed", {
      predicate: (request) => request.url().includes("q=first"),
      timeout: 5_000,
    });

    await page.locator(SEARCH_INPUT).fill("second");
    await expect(page.getByText("Fresh second result")).toBeVisible({
      timeout: 5_000,
    });

    // Proves the component actually called AbortController#abort() (a real
    // network cancellation), not just that the render happens to be correct.
    const abortedRequest = await staleRequestAborted;
    expect(abortedRequest.failure()?.errorText).toContain("ABORTED");

    // Wait past the stale response's hold time so it has had its chance to
    // land, then assert it never overwrote (or appended to) the fresh render.
    await page.waitForTimeout(STALE_HOLD_MS + DEBOUNCE_SETTLE_MS);
    await expect(page.getByText("Stale first result")).toHaveCount(0);
    await expect(page.getByText("Fresh second result")).toBeVisible();
  });

  test("moves the highlighted row with the arrow keys", async ({ page }) => {
    await openSearchOverlay(page);
    const cursorTitle = page.locator(".sr-item.cursor .sr-title");

    // Pages always render first and in fixed order (Dashboard, Settings, Sign
    // in) when the query is empty, so the cursor's starting position and the
    // arrow-key destinations are deterministic regardless of recent items.
    await expect(cursorTitle).toHaveText("Dashboard");

    await page.keyboard.press("ArrowDown");
    await expect(cursorTitle).toHaveText("Settings");

    await page.keyboard.press("ArrowUp");
    await expect(cursorTitle).toHaveText("Dashboard");
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
    // Mocked rather than run against the real seeded feed items: opening a
    // result calls feedStore.openItem(), which persists a real markRead sync
    // action (server/db) for an unread row. e2e/seed.ts only seeds once per
    // run (globalSetup, not per test) and every spec shares that data, so
    // consuming a real seeded item here would leave it permanently read for
    // every test that runs after this one in the same invocation. The mocked
    // row is already read (unread: false), so opening it fires no sync call.
    //
    // Still exercises the exact regression called out in #266/#247:
    // chooseRow() must hand the /api/search row shape straight through to
    // feedStore.openItem() without SearchOverlay.vue reshaping it first.
    const RESULT_TITLE = "Mocked search result for e2e";
    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: searchPageBody([mockSearchResult(1, RESULT_TITLE)]),
      });
    });

    await openSearchOverlay(page);
    // A query with no page-title/sub match keeps the Pages group empty, so
    // the Results group is the only group rendered and index 0 is
    // unambiguously the mocked row's cursor position.
    await page.locator(SEARCH_INPUT).fill("zzz-no-page-match-zzz");

    const cursorTitle = page.locator(".sr-item.cursor .sr-title");
    await expect(cursorTitle).toHaveText(RESULT_TITLE, { timeout: 5_000 });

    await page.keyboard.press("Enter");

    await expect(page.locator(".search-scrim")).not.toBeVisible();
    await expect(page.locator(".detail-sheet")).toBeVisible({
      timeout: 5_000,
    });
    await expect(page.locator(".detail-sheet")).toContainText(RESULT_TITLE);
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
