# Reader

All your content feeds — RSS, podcasts, YouTube, and Bluesky — in one quiet, chronological place.

## Requirements

- Node.js >= 24 (see [.nvmrc](.nvmrc))
- npm

## Setup

Install dependencies:

```bash
npm install
```

## Environment variables

Secrets are managed with [dotenvx](https://dotenvx.com). The `.env*` files are
committed to git **encrypted** — the only plaintext copy of the keys is
`.env.keys`, which is gitignored. One private key per environment decrypts the
matching file:

| File              | Environment        | Private key (in `.env.keys`)    |
| ----------------- | ------------------ | ------------------------------- |
| `.env`            | local dev          | `DOTENV_PRIVATE_KEY`            |
| `.env.dev`        | Netlify previews   | `DOTENV_PRIVATE_KEY_DEV`        |
| `.env.e2e`        | e2e tests / CI     | `DOTENV_PRIVATE_KEY_E2E`        |
| `.env.production` | Netlify production | `DOTENV_PRIVATE_KEY_PRODUCTION` |

The database URL, the Stripe keys, and `NUXT_SITE_URL` differ per environment;
the Clerk, Google, and Sentry values are identical across all of them.
`NUXT_SITE_URL` is the deployed origin (localhost for local/e2e, the stable
preview alias for `.env.dev`, the production origin for `.env.production`) —
OAuth redirect URIs and billing redirect targets are built from it. Because the
Google OAuth client is shared across environments, every environment's
`<NUXT_SITE_URL>/api/auth/youtube/callback` must be registered as an authorized
redirect URI on that one client (localhost, the preview alias, and the
production origin), and the YouTube connect flow must be started from the
configured origin — the state cookie and callback have to share a host, so
Netlify preview deploys must be reached via the pinned `.env.dev` alias, not a
per-deploy hostname. A missing or malformed `NUXT_SITE_URL` makes the OAuth and
billing routes return a 500 until it is set. See [`.env.example`](.env.example)
for the full variable reference and where to obtain each value.

**First-time setup:** restore `.env.keys` from your password manager, then point
local dev at your own Neon branch so it never touches production data:

```bash
dotenvx set DATABASE_URL "<your-neon-dev-branch-url>" -f .env
dotenvx set NUXT_DATABASE_URL "<your-neon-dev-branch-url>" -f .env
```

The npm scripts wrap commands in `dotenvx run`, so `npm run dev`, `npm run
build`, and `npm run e2e` decrypt the right file automatically. To change any
value later: `dotenvx set VAR "value" -f <file>`.

> **Losing `.env.keys` means the encrypted files can't be decrypted.** Keep it
> backed up in your password manager.

## Database

The app uses [Drizzle ORM](https://orm.drizzle.team) with a [Neon](https://neon.tech) serverless Postgres database.

### Schema

The schema lives in [`server/db/schema.ts`](server/db/schema.ts). Tables:

| Table           | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `users`         | One row per authenticated user, keyed by Clerk's `userId`           |
| `feeds`         | RSS and podcast feeds belonging to a user                           |
| `feed_items`    | Individual items fetched from a feed                                |
| `integrations`  | OAuth tokens for YouTube and Bluesky (encrypted at rest)            |
| `user_settings` | Per-user reading preferences                                        |
| `subscriptions` | Stripe billing state (customer, subscription, plan/status) per user |

### Token encryption

`integrations.accessToken` / `refreshToken` / `tokenSecret` (YouTube OAuth
tokens, Bluesky JWTs, and the Bluesky app password) are encrypted with
AES-256-GCM before they're written — see
[`server/utils/crypto.ts`](server/utils/crypto.ts) and
[`docs/api-auth-storage.md`](docs/api-auth-storage.md) for the design.
Requires `TOKEN_ENCRYPTION_KEY` (see [`.env.example`](.env.example) for how to
generate one); reads tolerate legacy plaintext rows written before encryption
was added, but you should run the one-off backfill once per environment to
migrate them:

```bash
npm run tokens:backfill                      # local (.env)
dotenvx run -f .env.production -- node scripts/backfill-encrypt-tokens.ts
```

### Deletion tombstones

When an account is deleted, `deletion_tombstones` keeps a marker so a session
minted just before deletion cannot resurrect an empty `users` row (Clerk
verifies JWTs networklessly). The marker is `sha256(provider_id + pepper)`, not
the raw Clerk id, so the retained value is a one-way equality token rather than
a re-linkable pseudonymous identifier — see
[`server/utils/tombstoneHash.ts`](server/utils/tombstoneHash.ts). Requires
`TOMBSTONE_ID_PEPPER` (see [`.env.example`](.env.example)); treat it as
permanent once set, since changing it orphans every existing tombstone. Lookups
tolerate legacy raw rows written before hashing was added, but run the one-off
backfill once per environment to migrate them:

```bash
npm run tombstones:backfill                  # local (.env)
dotenvx run -f .env.production -- node scripts/backfill-hash-tombstones.ts
```

### Database commands

Push the schema directly to Neon (useful for initial setup or during development):

```bash
npm run db:push
```

Generate a SQL migration file from schema changes:

```bash
npm run db:generate
```

Apply pending migrations:

```bash
npm run db:migrate
```

Open Drizzle Studio (visual database browser):

```bash
npm run db:studio
```

### Using the DB in server routes

`useDb()` is auto-imported in all Nitro server files:

```ts
// server/api/example.get.ts
export default defineEventHandler((event) => {
  const db = useDb();
  const user = event.context.user; // set by server/middleware/auth.ts
  return db.query.feedItems.findMany({
    where: (t, { eq }) => eq(t.feedId, user.id),
  });
});
```

## Authentication

Authentication is handled by [Clerk](https://clerk.com) via the [`@clerk/nuxt`](https://clerk.com/docs/references/nuxt/overview) module.

### How it works

1. `@clerk/nuxt` is registered in `nuxt.config.ts` and automatically protects routes via its built-in middleware
2. `app/middleware/auth.global.ts` — client-side route guard that redirects unauthenticated users to `/login` and signed-in users away from `/login`
3. `server/middleware/auth.ts` — runs on every server request; reads `event.context.auth()` (set by Clerk) and upserts the user into Neon via `getOrCreateUser()`
4. `event.context.user` is then available in all downstream API route handlers

### Account deletion webhook

`server/api/clerk/webhook.post.ts` verifies Clerk's Svix signature (via `@clerk/nuxt`'s `verifyWebhook`, wrapped in `server/utils/clerk.ts` so nothing else touches the SDK) and, on `user.deleted`, cascades the deletion into Neon: it purges billing, records a deletion tombstone, and deletes the `users` row (whose `ON DELETE CASCADE` removes feeds, feed items, integrations with their stored OAuth tokens, settings, and subscriptions). The cleanup logic is shared with the in-app deletion route in `server/utils/accountDeletion.ts`. Without this, deleting an account directly in Clerk would leave that data — including encrypted OAuth tokens — orphaned indefinitely.

To enable it, add a webhook endpoint in the Clerk Dashboard under **Configure → Webhooks** pointing at `<your-app-url>/api/clerk/webhook`, subscribed to the `user.deleted` event, then copy its **Signing Secret** into `NUXT_CLERK_WEBHOOK_SIGNING_SECRET`.

### Client composables

```ts
const { user } = useUser(); // reactive Clerk user object
const clerk = useClerk(); // ShallowRef<Clerk> — low-level access
const { isSignedIn } = useAuth(); // reactive auth state
```

### Sign out

```ts
const clerk = useClerk();
clerk.value?.signOut({ redirectUrl: "/login" });
```

## Billing

The paid Pro plan (monthly or yearly, both with a 14-day free trial) is handled by [Stripe](https://stripe.com) Checkout and Billing.

### How it works

1. `server/utils/stripe.ts` — the only file that imports the `stripe` package. Wraps Checkout Session creation, Stripe customer creation, and webhook signature verification behind small functions so nothing else in the app touches the Stripe SDK directly.
2. `server/utils/subscriptions.ts` — reads/writes the `subscriptions` table and maps a Stripe subscription status (`trialing`, `active`, `past_due`, `canceled`, etc.) to our own `plan` (`"free" | "pro"`).
3. `server/api/billing/checkout.post.ts` — authenticated route. Looks up (or creates) the user's Stripe customer, creates a Checkout Session for the requested interval with a 14-day trial, and returns the session URL.
4. `server/api/billing/webhook.post.ts` — verifies the Stripe signature on every request, then persists subscription state on `customer.subscription.created` / `.updated` / `.deleted`. We listen to the subscription lifecycle events (not `checkout.session.completed`) so renewals and cancellations stay in sync with one handler.
5. `server/api/billing/plan.get.ts` — authenticated route returning the caller's current plan/status, used by `SettingsAccount.vue`.
6. `app/composables/useBilling.ts` — client composable wrapping the two routes above; `startCheckout()` redirects the browser to the returned Checkout Session URL.

### Where to see it

- [`/pricing`](http://localhost:3000/pricing) — the Pro plan CTAs start checkout. Signed-out visitors are routed through `/login?redirect_url=...` first and checkout resumes automatically after sign-in.
- `/settings/account` — shows the caller's real plan (Free/Pro, trial end date) instead of a hardcoded label, with an "Upgrade to Pro" link back to `/pricing` when on the Free plan.

### Setup required to use this

1. Create a Stripe account (test mode is fine for development) and grab the secret key from **Developers → API keys**.
2. Create one Product ("Pro") with two recurring Prices — monthly and yearly (yearly priced at a discount) — and copy each **Price ID** (not the Product ID).
3. Add a webhook endpoint at **Developers → Webhooks** pointing at `<your-app-url>/api/billing/webhook`, subscribed to `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`. Copy its signing secret.
4. Set the four values below (see [`.env.example`](.env.example)) via `dotenvx set VAR "value" -f <file>` for each environment that needs them:

   | Variable                        | Purpose                                          |
   | ------------------------------- | ------------------------------------------------ |
   | `NUXT_STRIPE_SECRET_KEY`        | Server-side Stripe API key                       |
   | `NUXT_STRIPE_WEBHOOK_SECRET`    | Verifies webhook requests are really from Stripe |
   | `NUXT_STRIPE_PRICE_PRO_MONTHLY` | Price ID for the monthly Pro plan                |
   | `NUXT_STRIPE_PRICE_PRO_YEARLY`  | Price ID for the yearly Pro plan                 |
   | `NUXT_SITE_URL`                 | basin's public base URL for billing redirects    |

Checkout and billing-portal redirect targets (success, cancel, and return URLs)
are built from `NUXT_SITE_URL` — basin's own public base URL — rather than the
request's `Host` header, so a forged `Host` can't hijack the post-billing
redirect. Set `NUXT_SITE_URL` per environment (e.g. `http://localhost:3000`
locally, the real domain in production).

Local Stripe CLI users can forward webhooks during development with `stripe listen --forward-to localhost:3000/api/billing/webhook`, which prints a temporary signing secret to use for `NUXT_STRIPE_WEBHOOK_SECRET`.

## Offline / PGlite

The app uses [PGlite](https://pglite.dev) (`@electric-sql/pglite`) — a WASM build of Postgres running entirely in the browser, persisted via IndexedDB. This allows reads and writes to work without a network connection.

### How it works

1. `app/composables/useClientDb.ts` — lazy-initialises a PGlite instance at `idb://reader-app` and applies the DDL migrations on first load. Returns a Drizzle client with the same query API as the server.
2. `app/db/schema.ts` — client-side schema with three tables: `feeds`, `feed_items`, and `sync_queue`. No server-only tables (users, integrations, userSettings).
3. `app/composables/useSyncQueue.ts` — queues offline mutations to `sync_queue`, then flushes them to `POST /api/sync` when back online.
4. `app/plugins/sync.client.ts` — registers `online` and `visibilitychange` listeners that trigger a flush automatically.
5. `server/api/sync.post.ts` — applies queued mutations (`markRead`, `star`, `save`) to the Neon server DB.

### Usage

```ts
// Read or write locally (works offline)
const db = await useClientDb();
const items = await db.query.feedItems.findMany({ ... });

// Queue an action for server sync
const { queueAction } = useSyncQueue();
await queueAction("markRead", { guid: item.guid });

// Flush manually (called automatically on reconnect)
const { flushSyncQueue } = useSyncQueue();
await flushSyncQueue();
```

### Notes

- PGlite is excluded from Vite's `optimizeDeps` (`exclude: ['@electric-sql/pglite']`) to prevent Vite from trying to pre-bundle the WASM binary.
- The client schema intentionally omits foreign key constraints — PGlite is a local cache, not the source of truth.
- `sync_queue.syncedAt` is `null` for pending items; the flush loop stops on the first failure and retries on the next trigger.

## Development

Start the dev server at `http://localhost:3000`:

```bash
npm run dev
```

## Testing

Run tests in watch mode:

```bash
npm test
```

Run tests once (CI mode):

```bash
npm run test:ci
```

Open the Vitest UI:

```bash
npm run test:ui
```

## Linting

Check for lint and formatting issues:

```bash
npm run lint
```

Auto-fix issues:

```bash
npm run lint:fix
```

## Build & Preview

Build for production:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

## Deployment

The app deploys to Netlify automatically on push to `main` or `dev`. The build command runs tests before building:

```bash
npm run test:ci && npm run build
```

## Security scanning

The repo runs a deterministic security-scanner layer — secret detection and dependency vulnerability auditing — both locally and in CI.

### Secret scanning (gitleaks)

[gitleaks](https://github.com/gitleaks/gitleaks) scans for committed secrets using the rules in [`.gitleaks.toml`](.gitleaks.toml), which extend the bundled default ruleset with project-specific rules for Clerk secret keys (`sk_live_`/`sk_test_`) and Postgres/Neon connection strings that embed credentials.

- **Locally:** the [`.husky/pre-commit`](.husky/pre-commit) hook first runs `dotenvx ext precommit` (which blocks the commit if any tracked `.env*` file holds plaintext rather than encrypted values), then runs `gitleaks git --staged` and blocks the commit on any finding. Install gitleaks first ([instructions](https://github.com/gitleaks/gitleaks#installing)); if it is not installed the gitleaks step prints a warning and skips rather than failing.
- **In CI:** the `secret-scan` job downloads the pinned gitleaks release and runs the binary directly — scanning the PR commit range on pull requests and the full history on pushes to `main`. Any finding fails the build.

Run the staged scan manually:

```bash
gitleaks git --staged --config .gitleaks.toml --verbose
```

### Dependency auditing

The `dependency-audit` CI job runs `npm audit --json` and pipes it through [`scripts/audit-gate.js`](scripts/audit-gate.js), which **fails the build only on high or critical advisories**. Moderate and low advisories are printed as an informational summary without failing. [Dependabot](.github/dependabot.yml) opens grouped weekly PRs for minor and patch updates.

A small set of high advisories live in deep transitive dependencies of the Stackbit visual-editor toolchain (`@stackbit/*` → `@netlify/content-engine`) and Google Cloud Storage, with no fix available short of a breaking major upgrade. Those specific advisories are suppressed via a documented allowlist in [`scripts/audit-allowlist.js`](scripts/audit-allowlist.js) — each entry names the advisory ID, the package, and the reason. The allowlist carries a `reviewBy` expiry: once it passes, the gate fails until the entries are re-checked for upstream fixes and the date is bumped. Any **new** high/critical advisory that is not on the allowlist still fails the build, so the gate keeps its teeth.

Run the gate locally:

```bash
npm audit --json | node scripts/audit-gate.js
```

## Git Hooks

Husky runs two hooks. A **pre-commit** hook runs the dotenvx plaintext-env guard and the gitleaks staged-secret scan (see [Security scanning](#security-scanning)). A **pre-push** hook runs lint and tests. To skip hooks in CI, set `HUSKY=0`.
