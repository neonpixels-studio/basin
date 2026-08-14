import { defineConfig, devices } from "@playwright/test";

// Env is injected by dotenvx before Playwright starts (see the "e2e" npm
// scripts: `dotenvx run -f .env.e2e -- playwright test`). In CI the workflow
// overrides E2E_DATABASE_URL with a fresh per-run Neon branch.

// @clerk/testing requires standard CLERK_* names; map from Nuxt conventions
if (!process.env.CLERK_SECRET_KEY && process.env.NUXT_CLERK_SECRET_KEY) {
  process.env.CLERK_SECRET_KEY = process.env.NUXT_CLERK_SECRET_KEY;
}
if (
  !process.env.CLERK_PUBLISHABLE_KEY &&
  process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY
) {
  process.env.CLERK_PUBLISHABLE_KEY =
    process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// Mock server intercepts outbound OAuth API calls from the Nuxt server process.
// Must match the port used in e2e/mock-server.ts.
const MOCK_PORT = process.env.E2E_MOCK_SERVER_PORT ?? "3099";
const MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}`;

export default defineConfig({
  testDir: "./e2e/tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["html", { outputFolder: "e2e/report", open: "never" }], ["list"]],

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "on-first-retry",
  },

  projects: [
    // Runs first (no Clerk session exists yet) to test unauthenticated behavior.
    // Must run before "setup" to avoid Clerk dev FAPI returning a live session
    // to cookieless browser contexts.
    {
      name: "unauthenticated",
      testMatch: /auth-unauth\.spec\.ts/,
    },
    // Runs after unauthenticated tests to create e2e/.auth/user.json
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
      dependencies: ["unauthenticated"],
    },
    {
      name: "chromium",
      dependencies: ["setup"],
      // auth-unauth.spec.ts belongs to the "unauthenticated" project above.
      // All other specs — including account.spec.ts — run here with auth state.
      testIgnore: [/auth-unauth\.spec\.ts/],
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
    },
  ],

  webServer: {
    // dev:test is a raw `nuxt dev` (no dotenvx) — env comes from the dotenvx
    // run that started Playwright, merged with the overrides below.
    command: "npm run dev:test",
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      NUXT_DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      // Set explicitly so Nuxt's built-in .env loader can't inject the
      // encrypted (ciphertext) SENTRY_DSN from the committed .env file.
      // Empty DSN cleanly disables Sentry for e2e runs.
      SENTRY_DSN: "",
      NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
        process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "",
      NUXT_CLERK_SECRET_KEY: process.env.NUXT_CLERK_SECRET_KEY ?? "",
      NUXT_GOOGLE_CLIENT_ID: process.env.NUXT_GOOGLE_CLIENT_ID ?? "",
      NUXT_GOOGLE_CLIENT_SECRET: process.env.NUXT_GOOGLE_CLIENT_SECRET ?? "",
      // Route outbound Google API calls to the local mock server so e2e tests
      // never hit the real Google APIs.
      GOOGLE_TOKEN_URL: `${MOCK_BASE_URL}/token`,
      YOUTUBE_CHANNELS_URL: `${MOCK_BASE_URL}/youtube/v3/channels?part=snippet&mine=true`,
      // Route disconnect-time grant revocation to the mock server so e2e tests
      // never hit the real Google / Bluesky revocation endpoints.
      GOOGLE_REVOKE_URL: `${MOCK_BASE_URL}/revoke`,
      BLUESKY_DELETE_SESSION_URL: `${MOCK_BASE_URL}/xrpc/com.atproto.server.deleteSession`,
      // Allow the mock server's loopback address through SSRF validation so
      // feed-discovery e2e tests can use the mock RSS endpoint.
      NUXT_FEED_DISCOVERY_ALLOWED_HOSTS: `127.0.0.1:${MOCK_PORT}`,
      // Route feed-validation fetches through the mock server so no real HTTP
      // requests are made when adding a feed URL during e2e tests.
      FEED_FETCH_PROXY_URL: `${MOCK_BASE_URL}/feed-proxy`,
    },
    stdout: "pipe",
    stderr: "pipe",
  },
});
