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
// The current entries cover the unpatched `image-size` DoS advisories (no
// published fix — latest 2.0.2, advisory range <=2.0.2). image-size reaches the
// PRODUCTION tree via @netlify/async-workloads > @netlify/sdk > @netlify/dev-utils,
// so the suppression rests on unreachability (basin never feeds bytes to
// image-size's parsers), NOT on dev-only scope.
//
// A third entry used to cover the chained "@netlify/async-workloads depends on
// vulnerable @netlify/sdk" source advisory. It was removed 2026-09-07: the gate
// (which only tracks high/critical severity — see BLOCKING_SEVERITIES in
// audit-gate.js) reported no high/critical advisory for @netlify/async-workloads
// on that date, so the entry no longer matched anything. The root cause —
// @netlify/async-workloads still pulling the unpatched image-size above — is
// unchanged, so this chained advisory may reappear under a freshly regenerated
// `source-` id; if it does, the gate fails loudly (fail-closed) and the entry
// should be re-added rather than assuming it's gone for good.

export const ALLOWLIST_REVIEW_BY = "2026-09-27";

// `packages` lists the exact npm package name(s) the advisory is filed against
// (matched against `via.name` from `npm audit`). The gate only suppresses an
// advisory when BOTH its ID and the affected package match an entry — so if a
// "dev-only" package later moves into the production path under a different
// name, the suppression no longer applies and the gate fails as intended.
/** @type {Array<{ id: string, packages: string[], reason: string }>} */
export const ALLOWED_ADVISORIES = [
  {
    id: "GHSA-w3rx-r6r6-pgpr",
    packages: ["image-size"],
    reason:
      "image-size ICNS-parser DoS (infinite loop). No patched release exists: " +
      "latest published image-size is 2.0.2 and the advisory range is <=2.0.2, " +
      "so no override can resolve it. It ships in the PRODUCTION tree via the " +
      "@netlify/async-workloads runtime dependency " +
      "(@netlify/async-workloads > @netlify/sdk > ... > @netlify/dev-utils > image-size), " +
      "but the vulnerable code path — image header parsing — is never invoked by basin: " +
      "no basin route feeds attacker-controlled bytes to image-size. npm's only 'fix' is a " +
      "semver-major downgrade of the direct @netlify/async-workloads dependency. " +
      "Unreachability verified 2026-08-08 via " +
      "`grep -rniE 'image-size|@netlify/dev-utils|sharp|icns|jxl|heif' server app` — " +
      "no basin-owned call sites. Re-check for an image-size patch or an @netlify/sdk " +
      "chain that drops it by ALLOWLIST_REVIEW_BY.",
  },
  {
    id: "GHSA-5p2g-fcmc-qvqq",
    packages: ["image-size"],
    reason:
      "image-size JXL/HEIF-parser DoS (infinite loop). Same root cause and reachability " +
      "as GHSA-w3rx-r6r6-pgpr: no patched image-size release (latest 2.0.2, advisory " +
      "range <=2.0.2), and although it ships in the production tree via " +
      "@netlify/async-workloads > ... > @netlify/dev-utils, basin never passes " +
      "attacker-controlled bytes to image-size's parsers.",
  },
];

const ALLOWED_KEYS = new Set(
  ALLOWED_ADVISORIES.flatMap((advisory) =>
    advisory.packages.map((packageName) => `${advisory.id}::${packageName}`),
  ),
);

// An advisory is suppressed only when its ID AND affected package both match an
// allowlist entry, so a justification tied to where a package sits in the tree
// stops applying if a different package later trips the same advisory ID.
export function isAdvisoryAllowed(advisoryId, packageName) {
  return ALLOWED_KEYS.has(`${advisoryId}::${packageName}`);
}
