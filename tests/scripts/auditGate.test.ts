import { describe, it, expect } from "vitest";
import {
  advisoryIdFromUrl,
  assertUsableReport,
  collectBlockingAdvisories,
  isAllowlistExpired,
  parseAuditReport,
  partitionByAllowlist,
} from "../../scripts/audit-gate.js";
import {
  ALLOWED_ADVISORIES,
  ALLOWLIST_REVIEW_BY,
  isAdvisoryAllowed,
} from "../../scripts/audit-allowlist.js";

// Self-contained fixture IDs for partitionByAllowlist tests. These are
// deliberately NOT in the real allowlist, so they always land in "blocking" and
// stay valid regardless of which advisories the real list currently suppresses.
const TEST_ID = "GHSA-0000-test-abcd";
const TEST_PACKAGE = "test-package-fixture";

function advisoryVia(id: string, severity: string) {
  return {
    name: "some-package",
    url: `https://github.com/advisories/${id}`,
    severity,
    title: `${severity} advisory ${id}`,
  };
}

describe("advisoryIdFromUrl", () => {
  it("extracts the GHSA id from an advisory url", () => {
    expect(
      advisoryIdFromUrl("https://github.com/advisories/GHSA-abcd-1234"),
    ).toBe("GHSA-abcd-1234");
  });

  it("returns null for non-string input", () => {
    expect(advisoryIdFromUrl(undefined)).toBeNull();
  });
});

describe("collectBlockingAdvisories", () => {
  it("keeps only high and critical advisories", () => {
    const report = {
      vulnerabilities: {
        pkgA: { via: [advisoryVia("GHSA-high-1", "high")] },
        pkgB: { via: [advisoryVia("GHSA-mod-1", "moderate")] },
        pkgC: { via: [advisoryVia("GHSA-crit-1", "critical")] },
        pkgD: { via: [advisoryVia("GHSA-low-1", "low")] },
      },
    };
    const ids = collectBlockingAdvisories(report).map(
      (advisory) => advisory.id,
    );
    expect(ids.sort()).toEqual(["GHSA-crit-1", "GHSA-high-1"]);
  });

  it("ignores string via entries (names of other vulnerable deps)", () => {
    const report = {
      vulnerabilities: {
        pkgA: {
          via: ["another-vulnerable-dep", advisoryVia("GHSA-high-1", "high")],
        },
      },
    };
    const ids = collectBlockingAdvisories(report).map(
      (advisory) => advisory.id,
    );
    expect(ids).toEqual(["GHSA-high-1"]);
  });

  it("deduplicates advisories that surface under multiple packages", () => {
    const shared = advisoryVia("GHSA-shared", "high");
    const report = {
      vulnerabilities: {
        pkgA: { via: [shared] },
        pkgB: { via: [shared] },
      },
    };
    expect(collectBlockingAdvisories(report)).toHaveLength(1);
  });

  it("returns an empty array when there are no vulnerabilities", () => {
    expect(collectBlockingAdvisories({})).toEqual([]);
  });

  it("keeps a high advisory whose url cannot be parsed (fail closed)", () => {
    const report = {
      vulnerabilities: {
        pkgA: {
          via: [{ name: "pkgA", severity: "high", title: "no url here" }],
        },
      },
    };
    const advisories = collectBlockingAdvisories(report);
    expect(advisories).toHaveLength(1);
    expect(advisories[0].id).not.toBeNull();
    expect(advisories[0].severity).toBe("high");
  });
});

describe("partitionByAllowlist", () => {
  it("blocks all advisories when the allowlist is empty", () => {
    const advisories = [
      {
        id: TEST_ID,
        severity: "high",
        package: TEST_PACKAGE,
        title: "t",
      },
      {
        id: "GHSA-not-allowed",
        severity: "critical",
        package: "evil",
        title: "t",
      },
    ];
    const { suppressed, blocking } = partitionByAllowlist(advisories);
    expect(suppressed).toEqual([]);
    expect(blocking.map((advisory) => advisory.id).sort()).toEqual([
      TEST_ID,
      "GHSA-not-allowed",
    ]);
  });

  it("blocks an advisory even when only the package differs from a non-existent entry", () => {
    const advisories = [
      {
        id: TEST_ID,
        severity: "high",
        package: "some-other-runtime-package",
        title: "t",
      },
    ];
    const { suppressed, blocking } = partitionByAllowlist(advisories);
    expect(suppressed).toEqual([]);
    expect(blocking).toHaveLength(1);
  });

  it("blocks two packages sharing an advisory id when the allowlist is empty", () => {
    const report = {
      vulnerabilities: {
        pkgA: {
          via: [
            {
              name: TEST_PACKAGE,
              url: `https://github.com/advisories/${TEST_ID}`,
              severity: "high",
              title: "t",
            },
          ],
        },
        pkgNew: {
          via: [
            {
              name: "newly-vulnerable-pkg",
              url: `https://github.com/advisories/${TEST_ID}`,
              severity: "high",
              title: "t",
            },
          ],
        },
      },
    };
    const { suppressed, blocking } = partitionByAllowlist(
      collectBlockingAdvisories(report),
    );
    expect(suppressed).toEqual([]);
    expect(blocking.map((advisory) => advisory.package).sort()).toEqual([
      "newly-vulnerable-pkg",
      TEST_PACKAGE,
    ]);
  });

  it("blocks everything when nothing is allowlisted", () => {
    const advisories = [
      { id: "GHSA-x", severity: "high", package: "a", title: "t" },
      { id: "GHSA-y", severity: "critical", package: "b", title: "t" },
    ];
    const { suppressed, blocking } = partitionByAllowlist(advisories);
    expect(suppressed).toEqual([]);
    expect(blocking).toHaveLength(2);
  });

  it("suppresses every real allowlist entry by its exact id and package", () => {
    // Guard so this fails loudly (rather than passing vacuously on []) if the
    // allowlist is ever emptied without also revisiting these content tests.
    expect(ALLOWED_ADVISORIES.length).toBeGreaterThan(0);
    const advisories = ALLOWED_ADVISORIES.flatMap((entry) =>
      entry.packages.map((packageName) => ({
        id: entry.id,
        severity: "high",
        package: packageName,
        title: "t",
      })),
    );
    const { suppressed, blocking } = partitionByAllowlist(advisories);
    expect(blocking).toEqual([]);
    expect(suppressed).toHaveLength(advisories.length);
  });
});

describe("isAdvisoryAllowed (real allowlist)", () => {
  it("allows each real id::package pair", () => {
    expect(ALLOWED_ADVISORIES.length).toBeGreaterThan(0);
    for (const entry of ALLOWED_ADVISORIES) {
      for (const packageName of entry.packages) {
        expect(isAdvisoryAllowed(entry.id, packageName)).toBe(true);
      }
    }
  });

  it("rejects a real advisory id filed against a different package", () => {
    expect(ALLOWED_ADVISORIES.length).toBeGreaterThan(0);
    const [firstEntry] = ALLOWED_ADVISORIES;
    expect(isAdvisoryAllowed(firstEntry.id, "some-other-package")).toBe(false);
  });

  it("rejects an advisory id that is not on the allowlist", () => {
    expect(isAdvisoryAllowed("GHSA-unknown-id", "image-size")).toBe(false);
  });

  it("gives every entry a non-empty reason and a unique id::package key", () => {
    expect(ALLOWED_ADVISORIES.length).toBeGreaterThan(0);
    const keys = new Set<string>();
    for (const entry of ALLOWED_ADVISORIES) {
      expect(entry.packages.length).toBeGreaterThan(0);
      expect(entry.reason.trim().length).toBeGreaterThan(0);
      for (const packageName of entry.packages) {
        const key = `${entry.id}::${packageName}`;
        expect(keys.has(key)).toBe(false);
        keys.add(key);
      }
    }
  });

  // A chained "depends on vulnerable versions of X" advisory carries no upstream
  // GHSA url, so the gate derives its key as `source-<via.source>` (see
  // advisoryIdOrFallback in audit-gate.js). No entry in the real allowlist
  // currently uses this url-less shape (the last one, for @netlify/async-workloads,
  // was removed 2026-09-07 once npm audit stopped reporting it at all — see the
  // audit-allowlist.js header comment), so this covers the derivation directly
  // with a self-contained fixture (same pattern as TEST_ID/TEST_PACKAGE above)
  // instead of depending on the real allowlist containing a matching shape.
  it("derives a source-prefixed id for a url-less chained advisory", () => {
    const report = {
      vulnerabilities: {
        [TEST_PACKAGE]: {
          via: [
            {
              name: TEST_PACKAGE,
              url: null,
              source: "synthetic-test-source-value",
              severity: "high",
              title: "Depends on vulnerable versions",
            },
          ],
        },
      },
    };
    const advisories = collectBlockingAdvisories(report);
    expect(advisories.map((advisory) => advisory.id)).toEqual([
      "source-synthetic-test-source-value",
    ]);
  });
});

describe("assertUsableReport", () => {
  it("throws when npm audit returned an error object", () => {
    expect(() =>
      assertUsableReport({
        error: { code: "ENOLOCK", summary: "requires a lockfile" },
      }),
    ).toThrow(/requires a lockfile/);
  });

  it("throws when the vulnerabilities map is missing", () => {
    expect(() => assertUsableReport({ metadata: {} })).toThrow(
      /Unrecognized npm audit JSON shape/,
    );
  });

  it("accepts a report with a vulnerabilities map", () => {
    expect(() => assertUsableReport({ vulnerabilities: {} })).not.toThrow();
  });
});

describe("parseAuditReport", () => {
  it("throws on empty stdin rather than passing the gate", () => {
    expect(() => parseAuditReport("   ")).toThrow(/No npm audit JSON/);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseAuditReport("{not json")).toThrow();
  });

  it("rejects an error report instead of treating it as clean", () => {
    const raw = JSON.stringify({ error: { code: "ENOLOCK" } });
    expect(() => parseAuditReport(raw)).toThrow(/npm audit failed/);
  });
});

describe("isAllowlistExpired", () => {
  it("is false before the review date", () => {
    const dayBefore = new Date(`${ALLOWLIST_REVIEW_BY}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    expect(isAllowlistExpired(dayBefore)).toBe(false);
  });

  it("is true on or after the review date", () => {
    const onDate = new Date(`${ALLOWLIST_REVIEW_BY}T00:00:00Z`);
    expect(isAllowlistExpired(onDate)).toBe(true);
  });
});
