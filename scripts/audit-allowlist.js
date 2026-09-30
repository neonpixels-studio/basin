// Documented allowlist of dependency advisories the `dependency-audit` CI gate
// tolerates. The gate fails on any high/critical advisory NOT listed here, so a
// newly introduced vulnerability still breaks the build.
//
// Every entry must have a documented "no non-breaking fix available"
// justification in its `reason`. Periodic re-evaluation is forced by the single
// shared `ALLOWLIST_REVIEW_BY` date below: once it passes, the gate fails until
// every entry is re-reviewed (for an upstream fix) and the date is bumped.
//
// Previously this list contained 14 entries for the Stackbit/content-engine
// transitive chain. Those were eliminated by pinning `@netlify/sdk` to ^5.0.4
// via the `overrides` block in package.json — sdk 5.x dropped the
// @stackbit/* / @netlify/content-engine dependencies entirely.
//
// As of 2026-09-28 the list is empty: the two entries that used to live here
// (GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq, both filed against
// `image-size`'s ICNS/JXL/HEIF parsers) were resolved by a plain
// `npm audit fix` — @netlify/blobs' own dependency bump now resolves
// `@netlify/dev-utils > image-size` to 2.0.4, which contains the fix. No
// override or allowlist entry is needed anymore. Re-add an entry here only if
// a future advisory has no non-breaking fix available.
//
// A third entry used to suppress a chained "depends on vulnerable versions of
// @netlify/sdk" advisory filed against @netlify/async-workloads itself. As of
// the 2026-09-06 minor-and-patch bump (PR #235) `npm audit` no longer emits
// that advisory: the resolved dependency tree now surfaces the same image-size
// root cause through @netlify/dev-utils / @netlify/blobs `via` string
// references rather than a distinct advisory object, so nothing keys to
// @netlify/async-workloads anymore. Removed rather than re-dated — re-add only
// if `npm audit --json | jq '.vulnerabilities["@netlify/async-workloads"]'`
// produces a fresh chained advisory.
//
// `browserslist` is pinned via the `overrides` block in package.json (not this
// allowlist) to `^4.28.7`, the first version fixing GHSA-c83g-rgw3-j3cx
// (unbounded memory growth) and GHSA-73wf-gq98-2v4g (uncaught crash /
// prototype write via untrusted browserslist-stats.json); both advisories'
// vulnerable range is `<=4.28.6`. It reaches the tree transitively via
// `autoprefixer` (both the `@netlify/sdk--ui-react` dev chain and Nuxt's own
// `@nuxt/vite-builder` chain) and `@babel/helper-compilation-targets` (via
// `@sentry/nuxt`). Drop the override once every one of those direct
// dependencies bumps its own browserslist requirement past 4.28.6.
//
// `svgo` is pinned via the `overrides` block in package.json (not this
// allowlist) to `^4.1.0`, the first version clearing GHSA-w27v-7q3p-w38r
// (removeScripts executable-link bypass, high) and the related moderate
// GHSA-4vpr-x523-8j87 — both advisories' vulnerable range is
// `>=4.0.0 <4.1.0`. It reaches the tree only via
// `nuxt > @nuxt/vite-builder > cssnano > cssnano-preset-default >
// postcss-svgo`, which already declares `svgo@^4.0.2` (a range that admits
// 4.1.0 on its own), so the override is a forward guard against a future
// dependent requesting `svgo@^3`, not a constraint on today's resolution.
// Do not delete it as redundant; drop it once `postcss-svgo` itself declares
// `svgo@^4.1.0` or later.
//
// (No separate `sax` override: svgo 4.1.0 declares an exact `sax@1.6.1`
// dependency, which npm's resolver already uses to satisfy the unrelated
// `rss-parser > xml2js > sax@>=0.6.0` range tree-wide — verified by removing
// a candidate `sax` override and re-running `npm install`, which still
// resolves a single hoisted `sax@1.6.1`. Revisit only if `svgo` is ever
// removed from the tree, since that constraint is what pins `sax` today.)

export const ALLOWLIST_REVIEW_BY = "2026-10-19";

// `packages` lists the exact npm package name(s) the advisory is filed against
// (matched against `via.name` from `npm audit`). The gate only suppresses an
// advisory when BOTH its ID and the affected package match an entry — so if a
// "dev-only" package later moves into the production path under a different
// name, the suppression no longer applies and the gate fails as intended.
/** @type {Array<{ id: string, packages: string[], reason: string }>} */
export const ALLOWED_ADVISORIES = [];

// Builds an id::package lookup from a list of allowlist entries. Exported (not
// just the module-level `isAdvisoryAllowed` singleton below) so tests can
// exercise the real key-construction/matching logic against a fixture entry
// list, instead of reimplementing the match with an ad hoc predicate that
// could silently drift out of sync with this format.
export function createAllowlistLookup(entries) {
  const allowedKeys = new Set(
    entries.flatMap((advisory) =>
      advisory.packages.map((packageName) => `${advisory.id}::${packageName}`),
    ),
  );
  // An advisory is suppressed only when its ID AND affected package both match
  // an allowlist entry, so a justification tied to where a package sits in the
  // tree stops applying if a different package later trips the same advisory ID.
  return function isAdvisoryAllowed(advisoryId, packageName) {
    return allowedKeys.has(`${advisoryId}::${packageName}`);
  };
}

export const isAdvisoryAllowed = createAllowlistLookup(ALLOWED_ADVISORIES);
