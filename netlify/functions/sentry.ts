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
