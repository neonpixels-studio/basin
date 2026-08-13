// Fixed-window rate limiting for API routes, isolated here as a pure seam so
// the counting logic and the route→tier classification can be unit-tested
// without an HTTP layer. server/middleware/rateLimit.ts is the only production
// caller; it owns the shared store and the request/identity plumbing.
//
// SERVERLESS TRADEOFF (read before trusting these numbers): the store is an
// in-process Map. On Netlify each function instance keeps its own counters, so
// the effective ceiling scales with the number of warm instances, and a cold
// start wipes the window entirely. This is deliberately best-effort — it blunts
// a single hot instance being used for credential stuffing against
// /api/auth/bluesky or checkout-session spam against /api/billing/checkout
// without adding infrastructure. A hard, global guarantee needs a shared store
// (e.g. Redis/Upstash); basin's infra has none today, so this documents the
// weaker per-instance guarantee rather than pretending to a strong one.
//
// FIXED-WINDOW BURST: because each window is independent, a caller can send up
// to 2× the limit across a window boundary (the tail of window N plus the head
// of window N+1). That's inherent to fixed windows and acceptable here — a
// sliding window would be a deliberate future change; the tests pin the current
// boundary behavior so that switch can't happen by accident.

export const MILLISECONDS_PER_SECOND = 1000;

// One rolling window for every tier. Kept as one value (not per-tier) so the
// limits below read as "N requests per minute" against a single, obvious unit.
export const RATE_LIMIT_WINDOW_MS = 60_000;

// Sensitive auth/billing endpoints: live Bluesky auth (credential-stuffing
// vector), Stripe Checkout session creation (real cost per call), and OAuth
// callbacks. Tight ceiling — far above what a real user's UI triggers, far
// below what an attacker needs.
export const SENSITIVE_RATE_LIMIT = 10;

// Everything else under /api. Generous enough that normal dashboard usage
// (feed lists, search, settings) never trips it.
export const DEFAULT_RATE_LIMIT = 100;

// Hard cap on distinct keys held in a single instance's store, so a long-lived
// warm instance can't grow the Map without bound. On insert we first drop
// expired windows; if that isn't enough (pathological: this many distinct live
// clients on one instance inside a single window) we evict oldest-first to keep
// the bound hard. Eviction can flush a live counter early — which is only
// reachable by an attacker who can mint this many distinct keys, the same
// distributed abuse the shared-store note above already defers. Purely a memory
// guard; it never rejects a live request.
export const MAX_TRACKED_KEYS = 10_000;

export type RateLimitTier = "sensitive" | "default";

export interface RateLimitPolicy {
  tier: RateLimitTier;
  limit: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

interface RateLimitWindow {
  count: number;
  resetAt: number;
}

export type RateLimitStore = Map<string, RateLimitWindow>;

// The production store. The middleware shares this one instance; the util
// tests pass their own Map, and the middleware test imports and clears this one
// in beforeEach — so no suite leaks counters into another.
export const rateLimitStore: RateLimitStore = new Map();

// Route bases that get the sensitive tier. Deliberately broad on `/api/auth` so
// a future auth provider (login, callback, refresh) inherits the strict tier by
// default rather than silently landing on the loose one. `/api/billing/checkout`
// is listed specifically because it's the costly write; the cheap,
// high-frequency `/api/billing/plan` read stays on the default tier. A new
// costly billing write should be added here explicitly. Matched on a directory
// boundary (see matchesRoute) so a sibling like /api/authors or
// /api/billing/checkout-history is NOT swept into the strict tier.
// `/api/account` is the DELETE that erases the account: it makes two paid
// external calls (Stripe + Clerk) per request and is the most destructive
// route in the app, so it belongs on the strict tier, not the loose default.
const SENSITIVE_ROUTE_BASES = [
  "/api/auth",
  "/api/billing/checkout",
  "/api/account",
];

// Machine-to-machine endpoints that must never be rate limited: Stripe delivers
// webhooks from its own IP pool and retries aggressively, and the handler
// already verifies the Stripe signature. Matched exactly (not by prefix) so a
// look-alike like /api/billing/webhook-test can't inherit the exemption and
// become an unlimited hole.
const RATE_LIMIT_EXEMPT_PATHS = ["/api/billing/webhook"];

// True when `path` is one of `bases` exactly or a child route under it
// (`base/…`), but not a sibling that merely shares a string prefix.
function matchesRoute(path: string, bases: string[]): boolean {
  return bases.some((base) => path === base || path.startsWith(`${base}/`));
}

// Returns the policy to apply, or null when the path is not a rate-limited API
// route (non-/api paths and exempt endpoints).
export function resolveRateLimit(path: string): RateLimitPolicy | null {
  if (!path.startsWith("/api/")) {
    return null;
  }
  if (RATE_LIMIT_EXEMPT_PATHS.includes(path)) {
    return null;
  }
  if (matchesRoute(path, SENSITIVE_ROUTE_BASES)) {
    return { tier: "sensitive", limit: SENSITIVE_RATE_LIMIT };
  }
  return { tier: "default", limit: DEFAULT_RATE_LIMIT };
}

function pruneExpired(store: RateLimitStore, now: number): void {
  for (const [key, window] of store) {
    if (now >= window.resetAt) {
      store.delete(key);
    }
  }
}

// Map preserves insertion order, so its first keys are the oldest windows.
// Evicts oldest-first until the store is back under the cap.
function evictOldest(store: RateLimitStore): void {
  for (const oldestKey of store.keys()) {
    if (store.size < MAX_TRACKED_KEYS) {
      return;
    }
    store.delete(oldestKey);
  }
}

function enforceKeyCap(store: RateLimitStore, now: number): void {
  if (store.size < MAX_TRACKED_KEYS) {
    return;
  }
  pruneExpired(store, now);
  if (store.size < MAX_TRACKED_KEYS) {
    return;
  }
  evictOldest(store);
}

function startWindow(
  store: RateLimitStore,
  key: string,
  limit: number,
  now: number,
  windowMs: number,
): RateLimitResult {
  enforceKeyCap(store, now);
  const resetAt = now + windowMs;
  store.set(key, { count: 1, resetAt });
  return {
    allowed: true,
    limit,
    remaining: limit - 1,
    resetAt,
    retryAfterSeconds: 0,
  };
}

function rejectRequest(
  limit: number,
  now: number,
  resetAt: number,
): RateLimitResult {
  return {
    allowed: false,
    limit,
    remaining: 0,
    resetAt,
    retryAfterSeconds: Math.ceil((resetAt - now) / MILLISECONDS_PER_SECOND),
  };
}

// Records one request against `key` and reports whether it is allowed. Callers
// pass `now` (and their own store) so the function stays pure and deterministic
// under test.
export function checkRateLimit(
  store: RateLimitStore,
  key: string,
  limit: number,
  now: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
): RateLimitResult {
  const existing = store.get(key);
  if (!existing || now >= existing.resetAt) {
    return startWindow(store, key, limit, now, windowMs);
  }
  if (existing.count >= limit) {
    return rejectRequest(limit, now, existing.resetAt);
  }
  existing.count += 1;
  return {
    allowed: true,
    limit,
    remaining: limit - existing.count,
    resetAt: existing.resetAt,
    retryAfterSeconds: 0,
  };
}
