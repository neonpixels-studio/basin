<script setup>
import { computed, watch, ref, nextTick, onMounted, onUnmounted } from "vue";
import { SOURCES } from "~/lib/icons";

const { state, closeSearch, moveCursor } = useSearch();
const feedStore = useFeedStore();

const PAGES = [
  { kind: "page", id: "/", title: "Dashboard", sub: "Your unified feed" },
  {
    kind: "page",
    id: "/settings",
    title: "Settings",
    sub: "Feeds & connected accounts",
  },
  { kind: "page", id: "/login", title: "Sign in", sub: "Account & session" },
];

const serverResults = ref([]);
const searchLoading = ref(false);
const searchError = ref(null);
// Server pagination cursor for /api/search. Null means the first page hasn't
// loaded yet or the last page returned no further offset (end of results).
const nextOffset = ref(null);
const loadingMore = ref(false);
// A load-more failure is tracked separately from searchError: searchError
// replaces the whole results panel, which would hide already-loaded results,
// whereas a load-more failure must leave loaded results visible and only show
// an inline retry near the load-more control.
const loadMoreError = ref(null);

const pageMatchesQuery = (page, query) =>
  !query ||
  page.title.toLowerCase().includes(query) ||
  page.sub.toLowerCase().includes(query);

const recentItems = (items) =>
  items.slice(0, 6).map((item) => ({ kind: "item", ref: item }));

// Return the full server result object as ref so the renderer reads real
// type and source fields rather than fabricated values.
const serverResultItems = (results) =>
  results.map((result) => ({ kind: "item", ref: result }));

const searchGroups = computed(() => {
  const query = state.query.trim().toLowerCase();
  const pages = PAGES.filter((page) => pageMatchesQuery(page, query));
  const groups = [];

  if (pages.length) groups.push({ label: "Pages", rows: pages });

  if (!query) {
    const recent = recentItems(feedStore.state.items);
    if (recent.length) groups.push({ label: "Recent", rows: recent });
    return groups;
  }

  if (searchLoading.value) return groups;

  const resultItems = serverResultItems(serverResults.value);
  if (resultItems.length) groups.push({ label: "Results", rows: resultItems });

  return groups;
});

const searchFlat = computed(() => searchGroups.value.flatMap((g) => g.rows));

const srcVar = (type) => `var(--${SOURCES[type]?.cls ?? "accent"})`;
const srcLabel = (type) => SOURCES[type]?.label ?? type;

// Treat a body without an items array as a failure so a malformed 2xx response
// surfaces the error state instead of crashing the searchGroups computed on .map.
const isSearchPage = (page) => page && Array.isArray(page.items);

// The cursor must move strictly forward; a server that echoes back the same (or
// an earlier) offset would otherwise loop us on a page we already hold, so treat
// any non-advancing cursor as end-of-results. Mirrors feed.ts's resolveNextOffset.
function resolveNextOffset(rawNext, currentOffset) {
  if (typeof rawNext !== "number") {
    return null;
  }
  return rawNext > currentOffset ? rawNext : null;
}

// Tracks the AbortController for the current in-flight first-page /api/search
// request. Replaced each time a new request is fired so older responses are
// ignored.
let activeAbortController = null;
// Separate controller for an in-flight load-more request. A query change must
// cancel this too, so a stale append can't land after the query moved on.
let loadMoreAbortController = null;

function cancelPendingSearch() {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }
}

function cancelPendingLoadMore() {
  if (loadMoreAbortController) {
    loadMoreAbortController.abort();
    loadMoreAbortController = null;
  }
  loadingMore.value = false;
}

function resetPagination() {
  nextOffset.value = null;
  loadMoreError.value = null;
  cancelPendingLoadMore();
}

// Append a fetched page's items, dropping ids already loaded so a rank tie or a
// feed sync shifting offsets between pages can't render a duplicate row (which
// would also collide on the ':i' + id key). Mirrors feed.ts's appendPage.
function appendSearchPage(page, currentOffset) {
  const seenIds = new Set(serverResults.value.map((result) => result.id));
  serverResults.value = [
    ...serverResults.value,
    ...page.items.filter((item) => !seenIds.has(item.id)),
  ];
  nextOffset.value = resolveNextOffset(page.nextOffset, currentOffset);
}

async function fetchSearchResults(query) {
  cancelPendingSearch();
  // A fresh first page replaces the whole result set, so drop any in-flight
  // load-more and reset the cursor before it starts.
  resetPagination();

  if (!query) {
    serverResults.value = [];
    searchError.value = null;
    searchLoading.value = false;
    return;
  }

  const controller = new AbortController();
  activeAbortController = controller;

  searchLoading.value = true;
  searchError.value = null;

  try {
    const page = await $fetch(`/api/search?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    });

    if (!isSearchPage(page)) {
      throw new Error("Malformed search response");
    }

    // Only commit if this controller is still the active one (i.e. not superseded).
    if (activeAbortController === controller) {
      serverResults.value = page.items;
      nextOffset.value = resolveNextOffset(page.nextOffset, 0);
    }
  } catch (error) {
    if (activeAbortController === controller) {
      console.error("Search request failed", error);
      searchError.value = error;
      serverResults.value = [];
      nextOffset.value = null;
    }
  } finally {
    if (activeAbortController === controller) {
      searchLoading.value = false;
      activeAbortController = null;
    }
  }
}

const SEARCH_INPUT_ID = "reader-search-input";

const loadMoreButtonHasFocus = () =>
  typeof document !== "undefined" &&
  document.activeElement instanceof HTMLElement &&
  document.activeElement.classList.contains("search-load-more");

// When the final page removes the Load more button, focus would otherwise fall
// to <body>, where a stray Enter hits the window handler and opens/closes a
// result. Send it back to the search input so keyboard flow stays inside the
// overlay.
function returnFocusToSearchInput() {
  nextTick(() => {
    document.getElementById(SEARCH_INPUT_ID)?.focus();
  });
}

// Commit a fetched load-more page, unless a query change (or overlay close)
// superseded it — that would graft stale rows onto the newer query's results.
// If the final page removes the button while it held focus, hand focus back to
// the input so keyboard flow stays in the overlay.
function commitLoadMorePage(page, currentOffset, controller) {
  if (loadMoreAbortController !== controller) {
    return;
  }
  const buttonHadFocus = loadMoreButtonHasFocus();
  appendSearchPage(page, currentOffset);
  if (buttonHadFocus && nextOffset.value === null) {
    returnFocusToSearchInput();
  }
}

async function loadMoreResults() {
  const query = state.query.trim();
  if (nextOffset.value === null || loadingMore.value || !query) {
    return;
  }

  const currentOffset = nextOffset.value;
  const controller = new AbortController();
  loadMoreAbortController = controller;
  loadingMore.value = true;
  loadMoreError.value = null;

  try {
    const page = await $fetch(
      `/api/search?q=${encodeURIComponent(query)}&offset=${currentOffset}`,
      { signal: controller.signal },
    );
    if (!isSearchPage(page)) {
      throw new Error("Malformed search response");
    }
    commitLoadMorePage(page, currentOffset, controller);
  } catch (error) {
    if (loadMoreAbortController === controller) {
      console.error("Load more search results failed", error);
      loadMoreError.value = error;
    }
  } finally {
    if (loadMoreAbortController === controller) {
      loadingMore.value = false;
      loadMoreAbortController = null;
    }
  }
}

function retrySearch() {
  fetchSearchResults(state.query.trim());
}

function chooseRow(row) {
  if (row.kind === "page") navigateTo(row.id);
  else feedStore.openItem(row.ref);
  closeSearch();
}

function chooseCursor() {
  const row = searchFlat.value[state.cursor];
  if (row) chooseRow(row);
}

function onKey(e) {
  if (!state.open) return;
  const total = searchFlat.value.length;
  const dispatch = {
    Escape: () => closeSearch(),
    ArrowDown: () => {
      e.preventDefault();
      moveCursor(1, total);
    },
    ArrowUp: () => {
      e.preventDefault();
      moveCursor(-1, total);
    },
    Enter: () => {
      e.preventDefault();
      chooseCursor();
    },
  };
  dispatch[e.key]?.();
}

let debounceTimer = null;

watch(
  () => state.query,
  (newQuery) => {
    state.cursor = 0;
    // Clear the previous failure immediately so a stale "Search unavailable"
    // never lingers over a query that has not been attempted yet.
    searchError.value = null;
    clearTimeout(debounceTimer);
    // Cancel any in-flight request immediately so it cannot overwrite results
    // for the new query while the debounce delay is pending. Also drop any
    // in-flight load-more and reset the cursor so a stale append can't land.
    cancelPendingSearch();
    resetPagination();
    debounceTimer = setTimeout(() => {
      fetchSearchResults(newQuery.trim());
    }, 300);
  },
);

watch(
  () => state.open,
  (isOpen) => {
    if (!isOpen) {
      clearTimeout(debounceTimer);
      cancelPendingSearch();
      resetPagination();
      serverResults.value = [];
      searchError.value = null;
      searchLoading.value = false;
    }
  },
);

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  clearTimeout(debounceTimer);
  cancelPendingSearch();
  cancelPendingLoadMore();
});
</script>

<template>
  <div v-if="state.open" class="search-scrim" @click.self="closeSearch">
    <div class="search-modal">
      <div class="search-in">
        <RIcon name="search" :size="22" />
        <input
          id="reader-search-input"
          v-model="state.query"
          placeholder="search posts, podcasts, videos, pages…"
        />
        <span class="kbd">esc</span>
        <button class="icon-btn" @click="closeSearch">
          <RIcon name="x" :size="18" />
        </button>
      </div>

      <div class="search-results">
        <div v-if="searchLoading" class="empty" aria-live="polite">
          <p>Searching…</p>
        </div>

        <template v-else>
          <div v-if="searchError" class="search-error" role="alert">
            <p>Search is unavailable right now. Please try again.</p>
            <button class="btn" @keydown.enter.stop @click="retrySearch">
              Retry
            </button>
          </div>

          <template v-for="g in searchGroups" :key="g.label">
            <div class="sr-group">{{ g.label }}</div>
            <div
              v-for="row in g.rows"
              :key="row.kind === 'page' ? row.id : 'i' + row.ref.id"
              class="sr-item"
              :class="{ cursor: searchFlat.indexOf(row) === state.cursor }"
              @mouseenter="state.cursor = searchFlat.indexOf(row)"
              @click="chooseRow(row)"
            >
              <template v-if="row.kind === 'page'">
                <span class="sr-pill" style="--c: var(--accent-soft-ink)"
                  >PAGE</span
                >
                <div class="sr-main">
                  <div class="sr-title">{{ row.title }}</div>
                  <div class="sr-sub">{{ row.sub }}</div>
                </div>
              </template>
              <template v-else>
                <span
                  class="sr-pill"
                  :style="{ '--c': srcVar(row.ref.type) }"
                  >{{ srcLabel(row.ref.type) }}</span
                >
                <div class="sr-main">
                  <div class="sr-title">
                    {{ row.ref.title || row.ref.text || row.ref.caption }}
                  </div>
                  <div class="sr-sub">
                    {{ row.ref.source }} · {{ row.ref.meta || row.ref.time }}
                  </div>
                </div>
              </template>
              <span class="sr-arrow"
                ><RIcon name="arrowRight" :size="16"
              /></span>
            </div>
          </template>

          <template v-if="serverResults.length">
            <!-- One button stays mounted while more pages remain: it toggles to
            a busy label rather than unmounting, so keyboard focus never falls
            back to <body> (where a stray Enter would open a result and close
            the overlay). aria-disabled (not disabled) keeps it focusable while
            loading; loadMoreResults already no-ops a click mid-flight. -->
            <button
              v-if="nextOffset !== null"
              type="button"
              class="search-load-more"
              :aria-disabled="loadingMore"
              :aria-busy="loadingMore"
              @keydown.enter.stop
              @click="loadMoreResults"
            >
              {{ loadingMore ? "Loading more…" : "Load more" }}
            </button>

            <div
              v-if="loadMoreError"
              class="search-load-more-error"
              role="status"
            >
              Couldn't load more results — press Load more to try again.
            </div>
          </template>

          <div v-if="!searchError && !searchFlat.length" class="empty">
            <h3>No matches</h3>
            <p>Try a different word, source, or tag.</p>
          </div>
        </template>
      </div>

      <div class="search-foot">
        <span class="hint"><span class="kbd">↑↓</span> navigate</span>
        <span class="hint"><span class="kbd">↵</span> open</span>
        <span class="hint"><span class="kbd">esc</span> close</span>
      </div>
    </div>
  </div>
</template>

<style>
.search-scrim {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: color-mix(in oklab, var(--bg) 40%, #00000055);
  backdrop-filter: blur(3px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
}
.search-modal {
  width: min(760px, calc(100vw - 32px));
  margin-top: 11vh;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  animation: popSafe 0.22s var(--ease);
}
.search-in {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 18px;
  border-bottom: 1px solid var(--border);
}
.search-in .ricon {
  color: var(--muted);
  flex: none;
}
.search-in input {
  flex: 1;
  border: 0;
  background: transparent;
  outline: none;
  font-family: var(--font-mono);
  font-size: 18px;
  color: var(--ink);
  letter-spacing: -0.01em;
}
.search-in input::placeholder {
  color: var(--faint);
}
.search-results {
  max-height: 56vh;
  overflow-y: auto;
  padding: 8px;
}
.search-results .empty {
  padding: 48px 20px;
}
.sr-group {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--faint);
  padding: 12px 12px 6px;
}
.sr-item {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 12px;
  border-radius: 10px;
  cursor: pointer;
}
.sr-item:hover,
.sr-item.cursor {
  background: var(--surface-2);
}
.sr-pill {
  font-size: 9.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 4px 7px;
  border-radius: 6px;
  background: color-mix(in oklab, var(--c, var(--accent)) 15%, transparent);
  color: var(--c, var(--accent-soft-ink));
  flex: none;
  min-width: 58px;
  text-align: center;
}
.sr-main {
  min-width: 0;
  flex: 1;
}
.sr-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-sub {
  font-size: 11.5px;
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sr-arrow {
  color: var(--faint);
  flex: none;
}
.search-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 8px 4px;
  padding: 12px 14px;
  border: 1px solid var(--danger);
  border-radius: 10px;
  color: var(--danger);
  font-size: 13px;
}
.search-error .btn {
  flex: none;
}
.search-load-more {
  display: block;
  margin: 12px auto;
  padding: 8px 18px;
  font-size: 12.5px;
  color: var(--ink);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  cursor: pointer;
}
.search-load-more[aria-busy="true"] {
  color: var(--muted);
  cursor: default;
}
.search-load-more-error {
  text-align: center;
  padding: 16px 0;
  font-size: 12.5px;
  color: var(--danger);
}
.search-foot {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 11px 18px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--muted);
}
.search-foot .hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
</style>
