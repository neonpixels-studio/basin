import { test, expect, type Page, type Route } from "@playwright/test";

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

// Fulfills a route with a real /api/search 200 response — shared by every
// test that stubs a successful page, since each one otherwise repeats the
// same status/contentType/body triple.
function fulfillSearchPage(
  route: Route,
  items: Array<Record<string, unknown>> = [],
  nextOffset: number | null = null,
) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: searchPageBody(items, nextOffset),
  });
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
      await fulfillSearchPage(route);
    });

    await openSearchOverlay(page);
    const searchRequest = page.waitForRequest("**/api/search**", {
      timeout: 5_000,
    });
    // Each keystroke fires the v-model watcher. No artificial per-key delay:
    // pressSequentially's own dispatch gap is a minimum, not a maximum, so
    // adding one only risks a loaded CI box spacing keystrokes past the
    // 300ms debounce and firing more than one request.
    await page.locator(SEARCH_INPUT).pressSequentially("abc");
    await searchRequest;

    // Wait past the debounce window once more before asserting the full
    // array: a request having landed doesn't rule out a second (leaked) one
    // for the same query arriving right after — which is exactly the
    // debounce-leak regression this test names.
    await page.waitForTimeout(DEBOUNCE_SETTLE_MS);
    expect(requestedQueries).toEqual(["abc"]);
  });

  test("cancels a stale in-flight request when the query changes (AbortController)", async ({
    page,
  }) => {
    // Held open past the second query's response so a real race exists.
    // "requestfailed" (checked below) is the actual signal that the browser
    // cut the request — fulfill() resolving or rejecting here doesn't prove
    // that either way.
    const STALE_HOLD_MS = 1_000;

    await page.route("**/api/search**", async (route) => {
      const url = new URL(route.request().url());
      const query = url.searchParams.get("q");
      if (query === "first") {
        await new Promise((resolve) => setTimeout(resolve, STALE_HOLD_MS));
        try {
          await fulfillSearchPage(route, [
            mockSearchResult(1, "Stale first result"),
          ]);
        } catch {
          // The underlying request was already gone by the time fulfill()
          // ran (the expected outcome once the component aborts it).
        }
        return;
      }
      await fulfillSearchPage(route, [
        mockSearchResult(2, "Fresh second result"),
      ]);
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
    const failure = abortedRequest.failure();
    expect(failure).not.toBeNull();
    expect(failure!.errorText).toMatch(/aborted|cancell?ed/i);

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
    // interior arrow-key destinations are deterministic regardless of how
    // many "Recent" rows the real feed happens to contribute after them. The
    // wrap-around boundary below reads the actual last row instead of
    // assuming a fixed total, for the same reason.
    await expect(cursorTitle).toHaveText("Dashboard");

    await page.keyboard.press("ArrowDown");
    await expect(cursorTitle).toHaveText("Settings");

    await page.keyboard.press("ArrowUp");
    await expect(cursorTitle).toHaveText("Dashboard");

    // Boundary: ArrowUp from the first row must wrap to the last row, not
    // clamp or throw — moveCursor's modulo wrap (`(cursor + d + total) %
    // total`), not something the component satisfies by construction.
    const rowTitles = await page.locator(".sr-item .sr-title").allInnerTexts();
    const lastRowTitle = rowTitles[rowTitles.length - 1];
    await page.keyboard.press("ArrowUp");
    await expect(cursorTitle).toHaveText(lastRowTitle);

    // And ArrowDown from the last row wraps back to the first.
    await page.keyboard.press("ArrowDown");
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
    // Mocked rather than run against the real seeded feed items: e2e/seed.ts
    // seeds once per whole run (globalSetup) and every spec shares that data,
    // so opening a real unread item here would mark it read for every test
    // that runs after this one. Still exercises the regression called out in
    // #266/#247: chooseRow() must hand the /api/search row shape straight
    // through to feedStore.openItem().
    const RESULT_TITLE = "Mocked search result for e2e";
    await page.route("**/api/search**", (route) =>
      fulfillSearchPage(route, [mockSearchResult(1, RESULT_TITLE)]),
    );

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
      await fulfillSearchPage(route);
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
