// Netlify Functions bundle separately from the Nitro server build and never
// load sentry.server.config.ts (see nuxt.config.ts's SENTRY_DSN bake-in
// comment on why crypto.ts's TOKEN_ENCRYPTION_KEY has the same split). Without
// an Sentry.init() call here, the captureException/captureMessage calls
// app/lib/sentry.ts makes on behalf of server/utils/blueskyAdapter.ts (used by
// sync-feed.ts) would silently no-op in this runtime — the SDK never throws
// without a client, it just drops the event. Mirrors sentry.server.config.ts's
// init shape so both runtimes report to the same Sentry project consistently.
import * as Sentry from "@sentry/nuxt";
import { loadEnv } from "./env";

// Milliseconds flushSentry() waits for queued events to actually leave the
// process before giving up — see that function's comment for why this can't
// be skipped.
const FLUSH_TIMEOUT_MS = 2000;

let initialized = false;

export function initSentry(): void {
  if (initialized) {
    return;
  }
  loadEnv();
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
  initialized = true;
}

// Sentry.init() queues events and sends them over HTTP asynchronously — it
// does not await delivery. A Netlify Function's execution environment is
// frozen (or torn down) the instant the handler's promise settles, so any
// event captured moments earlier would otherwise never actually leave the
// process. Call this on every exit path of the handler (success or failure)
// after initSentry() has run.
//
// Never throws: this runs from a bare `finally` in the caller, so a rejected
// flush (a transport error, a client in a bad state) must not replace
// whatever error the handler was already failing with — that would corrupt
// the async workload's retry classification (e.g. turning a non-retryable
// ErrorDoNotRetry into a generic, retried failure) after a permanent-failure
// record may already have been written for it.
export async function flushSentry(): Promise<void> {
  try {
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  } catch (flushError) {
    console.error("Failed to flush Sentry before the worker froze", flushError);
  }
}
