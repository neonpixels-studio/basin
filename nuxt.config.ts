import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const mainCss = fileURLToPath(
  new URL("./app/assets/css/main.css", import.meta.url),
);
const marketingCss = fileURLToPath(
  new URL("./app/assets/css/marketing.css", import.meta.url),
);

// Must match the key shape server/utils/crypto.ts requires (32 bytes of hex
// = 64 hex characters) — checked again here so a malformed (not just
// missing) key also fails the build instead of shipping and throwing
// TokenEncryptionKeyError on the first OAuth callback or token refresh.
const TOKEN_ENCRYPTION_KEY_PATTERN = /^[0-9a-f]{64}$/i;

// Must match the minimum server/utils/tombstoneHash.ts enforces — checked again
// here so a missing/too-short pepper fails the build instead of throwing
// TombstonePepperError on the first account deletion or new-user check.
const MIN_TOMBSTONE_PEPPER_LENGTH = 16;

// `nuxt build` (both npm run build and build:dev — Netlify production and
// preview both go through this same command) always runs with
// NODE_ENV=production; only `nuxt dev` doesn't. Hard-failing unconditionally
// here would also block `nuxt dev`/`nuxt typecheck` for any contributor who
// hasn't set up a local TOKEN_ENCRYPTION_KEY, even for work that never
// touches integrations — so the missing/malformed-key guard below only
// blocks an actual deployable build. server/utils/crypto.ts still throws a
// precise TokenEncryptionKeyError at the real call site if dev code path
// ever touches an integration without a key.
const isProductionBuild = process.env.NODE_ENV === "production";

// A missing or malformed key here would otherwise bake an empty (or invalid)
// string into the server bundle (see the nitro.replace comment below) and
// silently ship with integration tokens unencryptable — fail the build
// instead of the deploy.
function requireTokenEncryptionKeyForBuild(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY ?? "";

  if (!isProductionBuild) {
    return key;
  }

  if (!TOKEN_ENCRYPTION_KEY_PATTERN.test(key)) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes) " +
        "before building — integration tokens (YouTube/Bluesky) cannot be " +
        "encrypted without it. Generate one with `openssl rand -hex 32` " +
        "and add it to this environment's dotenvx file.",
    );
  }

  return key;
}

// A missing or too-short pepper here would bake an empty/weak value into the
// server bundle (same nitro.replace mechanism as the encryption key below) and
// silently ship deletion tombstones that store guessable hashes — fail the
// build instead of the deploy. Only blocks a deployable production build so a
// contributor can still run `nuxt dev`/typecheck without a local pepper.
function requireTombstonePepperForBuild(): string {
  const pepper = process.env.TOMBSTONE_ID_PEPPER ?? "";

  if (!isProductionBuild) {
    return pepper;
  }

  if (pepper.length < MIN_TOMBSTONE_PEPPER_LENGTH) {
    throw new Error(
      "TOMBSTONE_ID_PEPPER must be set to at least " +
        `${MIN_TOMBSTONE_PEPPER_LENGTH} characters before building — deletion ` +
        "tombstones cannot be hashed without it. Generate one with " +
        "`openssl rand -hex 32` and add it to this environment's dotenvx file.",
    );
  }

  return pepper;
}

export default defineNuxtConfig({
  compatibilityDate: "2024-11-01",
  modules: ["@pinia/nuxt", "@clerk/nuxt", "@sentry/nuxt/module"],
  sourcemap: { client: "hidden" },
  sentry: {
    sourceMapsUploadOptions: {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
    },
  },
  clerk: {
    skipServerMiddleware: true,
  },
  // These read process.env INLINE (not "") so dotenvx-decrypted values bake into
  // the server bundle at build time. Nitro only serializes these defaults; it does
  // NOT re-inject NUXT_* at function runtime on Netlify, so leaving them "" would
  // resolve to empty in the deployed function unless the vars are set in Netlify.
  runtimeConfig: {
    databaseUrl: process.env.NUXT_DATABASE_URL || "",
    // basin's own public base URL, the trusted origin OAuth redirect URIs and
    // billing redirect targets are anchored to instead of the (spoofable)
    // request Host/origin, so a forged Host can't hijack the OAuth flow or the
    // post-billing bounce (see server/utils/siteUrl.ts, which throws a 500 if it
    // is unset or malformed at request time). Read INLINE like the values below
    // so dotenvx-decrypted values bake into the server bundle at build time.
    // Must be set per environment in the dotenvx files.
    siteUrl: process.env.NUXT_SITE_URL || "",
    googleClientId: process.env.NUXT_GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.NUXT_GOOGLE_CLIENT_SECRET || "",
    disableSignups: process.env.NUXT_DISABLE_SIGNUPS || "",
    clerk: {
      secretKey: process.env.NUXT_CLERK_SECRET_KEY || "",
      // Read by @clerk/nuxt's verifyWebhook to authenticate incoming Clerk
      // webhooks (Svix signature). Verifies user.deleted so a Clerk-side
      // account deletion cascades into our database.
      webhookSigningSecret: process.env.NUXT_CLERK_WEBHOOK_SIGNING_SECRET || "",
    },
    stripeSecretKey: process.env.NUXT_STRIPE_SECRET_KEY || "",
    stripeWebhookSecret: process.env.NUXT_STRIPE_WEBHOOK_SECRET || "",
    stripePriceProMonthly: process.env.NUXT_STRIPE_PRICE_PRO_MONTHLY || "",
    stripePriceProYearly: process.env.NUXT_STRIPE_PRICE_PRO_YEARLY || "",
    public: {
      clerk: {
        publishableKey: process.env.NUXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "",
      },
      // Baked at build so sentry.client.config.ts can read it via
      // useRuntimeConfig().public.sentry.dsn. The DSN is not secret (it ships to
      // the browser). Single source of truth: SENTRY_DSN in the dotenvx files.
      sentry: {
        dsn: process.env.SENTRY_DSN || "",
      },
    },
  },
  devtools: { enabled: true },
  future: { compatibilityVersion: 4 },
  nitro: {
    preset: "netlify",
    // sentry.server.config.ts must read the DSN via process.env (Sentry loads
    // before useRuntimeConfig() is available), and dotenvx does NOT run in the
    // deployed function. Statically bake the build-time value into the server
    // bundle so SENTRY_DSN stays sourced only from the dotenvx files.
    //
    // server/utils/crypto.ts reads TOKEN_ENCRYPTION_KEY the same way (raw
    // process.env, per docs/api-auth-storage.md) so it can also be called
    // from netlify/functions/sync-feed.ts, which decrypts its own env at
    // runtime via loadEnv() and never goes through this Nitro build. Baking
    // it here covers the server/api/* (Nitro) call sites the same way.
    replace: {
      "process.env.SENTRY_DSN": JSON.stringify(process.env.SENTRY_DSN || ""),
      "process.env.TOKEN_ENCRYPTION_KEY": JSON.stringify(
        requireTokenEncryptionKeyForBuild(),
      ),
      // server/utils/tombstoneHash.ts reads TOMBSTONE_ID_PEPPER via raw
      // process.env for the same reason as the key above; bake it in so the
      // server/api/* (Nitro) call sites resolve it at runtime.
      "process.env.TOMBSTONE_ID_PEPPER": JSON.stringify(
        requireTombstonePepperForBuild(),
      ),
    },
  },
  css: [mainCss, marketingCss],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["@vue/devtools-core", "@vue/devtools-kit"],
      exclude: ["@electric-sql/pglite"],
    },
  },
  app: {
    head: {
      title: "Reader — all your feeds, one place",
      meta: [
        { charset: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        {
          name: "description",
          content:
            "Every feed you follow — articles, podcasts, videos, posts — in one quiet, chronological place.",
        },
      ],
      link: [
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        {
          rel: "preconnect",
          href: "https://fonts.gstatic.com",
          crossorigin: "",
        },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&display=swap",
        },
        {
          rel: "icon",
          type: "image/svg+xml",
          href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect x='14' y='16' width='36' height='9' rx='4.5' fill='%23b3a3ff'/%3E%3Crect x='11' y='28' width='42' height='9' rx='4.5' fill='%238c74ff'/%3E%3Crect x='16' y='40' width='32' height='9' rx='4.5' fill='%237c5cff'/%3E%3C/svg%3E",
        },
      ],
    },
  },
  routeRules: {},
});
