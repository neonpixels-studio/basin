// Dependency-audit gate. Reads `npm audit --json` from stdin, keeps only
// high/critical advisories, drops the ones in the documented allowlist
// (scripts/audit-allowlist.js), and exits non-zero if any high/critical
// advisory remains. A NEW high/critical advisory that is not allowlisted still
// fails the build, so the gate stays meaningful.
//
// Usage (see .github/workflows/ci.yml):
//   npm audit --json | node scripts/audit-gate.js

import { pathToFileURL } from "node:url";
import {
  ALLOWED_ADVISORIES,
  ALLOWLIST_REVIEW_BY,
  isAdvisoryAllowed,
} from "./audit-allowlist.js";

const BLOCKING_SEVERITIES = new Set(["high", "critical"]);
const EXIT_FAILURE = 1;
export const UNIDENTIFIED_ADVISORY_ID = "UNIDENTIFIED";

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () =>
      resolve(Buffer.concat(chunks).toString("utf8")),
    );
    process.stdin.on("error", reject);
  });
}

// npm emits an error object (not a vulnerability report) when the audit itself
// fails — no lockfile, registry unreachable, auth error. That JSON parses fine
// but has no `vulnerabilities`, so without this guard the gate would treat a
// broken audit as clean and pass. Fail loud instead.
export function assertUsableReport(auditReport) {
  if (auditReport.error) {
    const detail =
      auditReport.error.summary || auditReport.error.code || "unknown error";
    throw new Error(`npm audit failed: ${detail}`);
  }
  if (
    typeof auditReport.vulnerabilities !== "object" ||
    auditReport.vulnerabilities === null
  ) {
    throw new Error(
      "Unrecognized npm audit JSON shape (no `vulnerabilities` map) — refusing to pass the gate.",
    );
  }
}

export function parseAuditReport(rawJson) {
  if (!rawJson.trim()) {
    throw new Error("No npm audit JSON received on stdin.");
  }
  const auditReport = JSON.parse(rawJson);
  assertUsableReport(auditReport);
  return auditReport;
}

export function advisoryIdFromUrl(url) {
  if (typeof url !== "string") {
    return null;
  }
  const segments = url.split("/");
  return segments[segments.length - 1] || null;
}

// A blocking-severity advisory we cannot identify must never be silently
// dropped — it can't match the id-keyed allowlist, so a non-null fallback id
// keeps it in the blocking set and fails the build (fail closed).
function advisoryIdOrFallback(via) {
  const id = advisoryIdFromUrl(via.url);
  if (id) {
    return id;
  }
  if (via.source != null) {
    return `source-${via.source}`;
  }
  return UNIDENTIFIED_ADVISORY_ID;
}

function isBlockingAdvisoryObject(via) {
  if (typeof via !== "object" || via === null) {
    return false;
  }
  return BLOCKING_SEVERITIES.has(via.severity);
}

// `via` entries are either a string (name of another vulnerable dep) or an
// object describing the advisory. We only care about blocking advisory objects.
function blockingAdvisoriesFromVia(viaList) {
  return (viaList || []).filter(isBlockingAdvisoryObject).map((via) => ({
    id: advisoryIdOrFallback(via),
    severity: via.severity,
    package: via.name,
    title: via.title,
  }));
}

function advisoryKey(advisory) {
  return `${advisory.id}::${advisory.package}`;
}

// Dedupe on id AND package: the allowlist is keyed on the same pair, so
// collapsing two packages that share one advisory id would let an
// un-allowlisted package ride in on an allowlisted one and slip past the gate.
function dedupeByIdAndPackage(advisories) {
  const byKey = new Map();
  for (const advisory of advisories) {
    if (byKey.has(advisoryKey(advisory))) {
      continue;
    }
    byKey.set(advisoryKey(advisory), advisory);
  }
  return [...byKey.values()];
}

export function collectBlockingAdvisories(auditReport) {
  const vulnerabilities = auditReport.vulnerabilities || {};
  const allAdvisories = Object.values(vulnerabilities).flatMap(
    (vulnerability) => blockingAdvisoriesFromVia(vulnerability.via),
  );
  return dedupeByIdAndPackage(allAdvisories);
}

export function isAllowlistExpired(now = new Date()) {
  const reviewDate = new Date(`${ALLOWLIST_REVIEW_BY}T00:00:00Z`);
  if (Number.isNaN(reviewDate.getTime())) {
    throw new Error(
      `Invalid ALLOWLIST_REVIEW_BY (${ALLOWLIST_REVIEW_BY}); expected YYYY-MM-DD.`,
    );
  }
  return now >= reviewDate;
}

function reportAllowlistExpired() {
  console.error(
    `Audit allowlist expired on ${ALLOWLIST_REVIEW_BY}. Re-review every entry in ` +
      `scripts/audit-allowlist.js (check for upstream fixes) and bump ALLOWLIST_REVIEW_BY.`,
  );
}

function reportSuppressed(suppressedAdvisories) {
  if (!suppressedAdvisories.length) {
    return;
  }
  console.log(
    `Allowlisted (suppressed) high/critical advisories: ${suppressedAdvisories.length}`,
  );
  for (const advisory of suppressedAdvisories) {
    console.log(
      `  - ${advisory.id} [${advisory.severity}] ${advisory.package}`,
    );
  }
}

function reportBlocking(blockingAdvisories) {
  console.error(
    `Found ${blockingAdvisories.length} high/critical advisory(ies) not in the allowlist:`,
  );
  for (const advisory of blockingAdvisories) {
    console.error(
      `  - ${advisory.id} [${advisory.severity}] ${advisory.package}: ${advisory.title}`,
    );
  }
  console.error(
    "Fix the dependency, or — only if there is no non-breaking fix — add a justified, " +
      "dated entry to scripts/audit-allowlist.js.",
  );
}

export function partitionByAllowlist(advisories) {
  const suppressed = [];
  const blocking = [];
  for (const advisory of advisories) {
    const bucket = isAdvisoryAllowed(advisory.id, advisory.package)
      ? suppressed
      : blocking;
    bucket.push(advisory);
  }
  return { suppressed, blocking };
}

function entryMatchedAdvisory(entry, suppressedAdvisories) {
  return suppressedAdvisories.some(
    (advisory) =>
      advisory.id === entry.id && entry.packages.includes(advisory.package),
  );
}

function warnOnStaleAllowlistEntries(suppressedAdvisories) {
  const staleEntries = ALLOWED_ADVISORIES.filter(
    (entry) => !entryMatchedAdvisory(entry, suppressedAdvisories),
  );
  if (!staleEntries.length) {
    return;
  }
  console.log(
    `Note: ${staleEntries.length} allowlist entry(ies) no longer match any advisory ` +
      "and can be removed from scripts/audit-allowlist.js:",
  );
  for (const entry of staleEntries) {
    console.log(`  - ${entry.id} (${entry.packages.join(", ")})`);
  }
}

async function main() {
  if (isAllowlistExpired()) {
    reportAllowlistExpired();
    process.exit(EXIT_FAILURE);
  }

  const auditReport = parseAuditReport(await readStdin());
  const advisories = collectBlockingAdvisories(auditReport);
  const { suppressed, blocking } = partitionByAllowlist(advisories);

  reportSuppressed(suppressed);
  warnOnStaleAllowlistEntries(suppressed);

  if (blocking.length) {
    reportBlocking(blocking);
    process.exit(EXIT_FAILURE);
  }

  console.log(
    "Dependency audit passed: no un-allowlisted high/critical advisories.",
  );
}

function isDirectInvocation() {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }
  return import.meta.url === pathToFileURL(entrypoint).href;
}

if (isDirectInvocation()) {
  main().catch((error) => {
    console.error(`audit-gate failed: ${error.message}`);
    process.exit(EXIT_FAILURE);
  });
}
