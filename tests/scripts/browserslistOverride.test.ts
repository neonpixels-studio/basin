import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// The first browserslist release fixing both GHSA-c83g-rgw3-j3cx (unbounded
// memory growth) and GHSA-73wf-gq98-2v4g (uncaught crash / prototype write
// via untrusted browserslist-stats.json) — see scripts/audit-allowlist.js for
// the full writeup. Both advisories' vulnerable range is <=4.28.6.
const FIRST_PATCHED_BROWSERSLIST_VERSION = [4, 28, 7];

// Minimal semver-floor parser for a caret/tilde/exact override string (e.g.
// "^4.28.7"). Not a general semver parser — just enough to read the numeric
// floor out of the handful of override shapes this repo actually writes, so
// this guard doesn't need a new dependency for one comparison. Anything else
// (a non-string value like npm's nested `{ ".": "^4.28.7" }` override form, a
// range list like "^4.28.7 || ^5.0.0", an "x.y.z <a.b.c" comparator range)
// throws rather than silently parsing to NaN/0, so a format this parser can't
// read fails loud with an actionable message instead of a confusing false
// "version too low" red. `source` identifies which field is being parsed (the
// package.json override vs. a specific package-lock.json resolution) so the
// error points at the right file.
function parseVersionFloor(versionRange: unknown, source: string): number[] {
  if (typeof versionRange !== "string") {
    throw new Error(
      `Expected a version string for ${source}, received ${typeof versionRange} ` +
        `(${JSON.stringify(versionRange)}); update parseVersionFloor if the override format changed.`,
    );
  }
  const match = /^[\^~>=]*(\d+)\.(\d+)\.(\d+)\s*$/.exec(versionRange.trim());
  if (!match) {
    throw new Error(
      `Cannot read a version floor from ${source} (${versionRange}); ` +
        "update parseVersionFloor if the override format changed.",
    );
  }
  return match.slice(1).map(Number);
}

function isAtLeast(versionParts: number[], minimumParts: number[]): boolean {
  const firstDifferingIndex = minimumParts.findIndex(
    (minimumPart, index) => (versionParts[index] ?? 0) !== minimumPart,
  );
  if (firstDifferingIndex === -1) {
    return true;
  }
  return (
    (versionParts[firstDifferingIndex] ?? 0) > minimumParts[firstDifferingIndex]
  );
}

describe("browserslist dependency override", () => {
  it("pins browserslist at or above the version patching both GHSA advisories", () => {
    const packageJsonPath = join(__dirname, "../../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    const overrideRange = packageJson.overrides?.browserslist;

    expect(
      overrideRange,
      "expected an `overrides.browserslist` entry in package.json — removing it " +
        "reopens GHSA-c83g-rgw3-j3cx and GHSA-73wf-gq98-2v4g (see scripts/audit-allowlist.js)",
    ).toBeDefined();

    const floor = parseVersionFloor(overrideRange, "overrides.browserslist");
    expect(
      isAtLeast(floor, FIRST_PATCHED_BROWSERSLIST_VERSION),
      `overrides.browserslist (${overrideRange}) must be at least ` +
        `${FIRST_PATCHED_BROWSERSLIST_VERSION.join(".")} to stay patched`,
    ).toBe(true);
  });

  // The `overrides` entry only constrains what npm is *allowed* to resolve —
  // it takes effect solely once `package-lock.json` is regenerated. CI runs
  // `npm ci`, which installs strictly from the lock and never re-resolves, so
  // an override edited without a matching `npm install` (or a lock that
  // regresses some other way) would pass the assertion above while every
  // resolved copy in the tree stayed vulnerable. This asserts the version
  // actually locked, which is what `npm ci` actually installs.
  it("locks every resolved copy of browserslist at or above the patched version", () => {
    const packageLockPath = join(__dirname, "../../package-lock.json");
    const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
    const browserslistEntries = Object.entries(
      packageLock.packages || {},
    ).filter(([packagePath]) =>
      packagePath.endsWith("node_modules/browserslist"),
    );

    expect(
      browserslistEntries.length,
      "expected package-lock.json to contain at least one resolved browserslist package",
    ).toBeGreaterThan(0);

    for (const [packagePath, packageEntry] of browserslistEntries) {
      const resolvedVersion = (packageEntry as { version?: string }).version;
      expect(
        resolvedVersion,
        `expected a resolved version for ${packagePath}`,
      ).toBeDefined();
      const floor = parseVersionFloor(resolvedVersion, packagePath);
      expect(
        isAtLeast(floor, FIRST_PATCHED_BROWSERSLIST_VERSION),
        `${packagePath} resolves to ${resolvedVersion}, below the patched floor ` +
          `${FIRST_PATCHED_BROWSERSLIST_VERSION.join(".")} — run \`npm install\` so the ` +
          "overrides entry actually takes effect in the lockfile",
      ).toBe(true);
    }
  });
});
