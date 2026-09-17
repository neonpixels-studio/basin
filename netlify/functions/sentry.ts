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
export async function flushSentry(): Promise<void> {
  await Sentry.flush(FLUSH_TIMEOUT_MS);
}
