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
// this guard doesn't need a new dependency for one comparison.
function parseVersionFloor(versionRange: string): number[] {
  const numericPart = versionRange.replace(/^[\^~>=]+/, "");
  return numericPart.split(".").map(Number);
}

function isAtLeast(versionParts: number[], minimumParts: number[]): boolean {
  for (let index = 0; index < minimumParts.length; index += 1) {
    const versionPart = versionParts[index] ?? 0;
    const minimumPart = minimumParts[index] ?? 0;
    if (versionPart !== minimumPart) {
      return versionPart > minimumPart;
    }
  }
  return true;
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

    const floor = parseVersionFloor(overrideRange);
    expect(
      isAtLeast(floor, FIRST_PATCHED_BROWSERSLIST_VERSION),
      `overrides.browserslist (${overrideRange}) must be at least ` +
        `${FIRST_PATCHED_BROWSERSLIST_VERSION.join(".")} to stay patched`,
    ).toBe(true);
  });
});
