import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const NETLIFY_CONFIG_PATH = resolve(process.cwd(), "netlify.toml");
const DEPLOY_WORKFLOW_PATH = resolve(
  process.cwd(),
  ".github/workflows/weekly-production-deploy.yml",
);
const CI_WORKFLOW_PATH = resolve(process.cwd(), ".github/workflows/ci.yml");
const SKIP_GUARD = "if: steps.recent.outputs.skip != 'true'";

const PRODUCTION_CONTEXT_PATTERN =
  /^\[context\.production\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m;
const IGNORE_LINE_PATTERN = /^\s*ignore\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/m;
const CRON_PATTERN = /^\s*-\s*cron:\s*"([^"]+)"/m;

const workflow = readFileSync(DEPLOY_WORKFLOW_PATH, "utf8");
const steps = workflow.split(/^ {6}- /m).slice(1);

function findStep(marker: string) {
  const step = steps.find((candidate) => candidate.includes(marker));
  if (!step) {
    throw new Error(`No workflow step contains "${marker}"`);
  }
  return step;
}

function stepIndex(marker: string) {
  return steps.indexOf(findStep(marker));
}

function readIgnoreCommand(section: string | undefined) {
  const rawCommand = section?.match(IGNORE_LINE_PATTERN)?.[1];
  return rawCommand?.replace(/\\"/g, '"');
}

function runIgnoreCommand(command: string, hookTitle: string | undefined) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  if (hookTitle !== undefined) {
    env.INCOMING_HOOK_TITLE = hookTitle;
  }
  return spawnSync("sh", ["-c", command], { env }).status;
}

describe("netlify.toml production gate", () => {
  const config = readFileSync(NETLIFY_CONFIG_PATH, "utf8");

  it("declares ignore only in the production context, never at build level", () => {
    const buildSection = config.match(/^\[build\]\s*$([\s\S]*?)(?=^\[)/m)?.[1];
    expect(buildSection).toBeDefined();
    expect(buildSection).not.toMatch(/^\s*ignore\s*=/m);
  });

  it("builds (exit 1) when triggered by a build hook and cancels (exit 0) otherwise", () => {
    const section = config.match(PRODUCTION_CONTEXT_PATTERN)?.[1];
    const command = readIgnoreCommand(section);
    expect(command).toBeDefined();
    expect(runIgnoreCommand(command!, "Weekly production deploy")).toBe(1);
    expect(runIgnoreCommand(command!, undefined)).toBe(0);
    expect(runIgnoreCommand(command!, "")).toBe(0);
  });
});

describe("weekly-production-deploy workflow triggers", () => {
  it("runs on Mondays 14:00 UTC and on manual dispatch", () => {
    expect(workflow.match(CRON_PATTERN)?.[1]).toBe("0 14 * * 1");
    expect(workflow).toMatch(/^ {2}workflow_dispatch:/m);
  });

  it("only runs from main", () => {
    expect(workflow).toContain("if: github.ref == 'refs/heads/main'");
  });
});

describe("weekly-production-deploy workflow steps", () => {
  it("only skips on the schedule event, based on a 7-day commit window", () => {
    const step = findStep("id: recent");
    expect(step).toContain('[ "$EVENT_NAME" != "schedule" ]');
    expect(step).toContain("git log --since='7 days ago'");
    expect(step).toContain("skip=true");
  });

  it.each([
    "Require the build hook secret",
    "Require green CI on main HEAD",
    "npm ci",
    "db:migrate:production",
    "Trigger Netlify production build hook",
  ])("skips %s when there are no recent commits", (marker) => {
    expect(findStep(marker)).toContain(SKIP_GUARD);
  });

  it("fails when the hook secret is empty, before any migration runs", () => {
    const step = findStep("Require the build hook secret");
    expect(step).toContain(
      "NETLIFY_BUILD_HOOK_URL: ${{ secrets.NETLIFY_BUILD_HOOK_URL }}",
    );
    expect(step).toContain('[ -z "$NETLIFY_BUILD_HOOK_URL" ]');
    expect(step).toContain("exit 1");
    expect(stepIndex("Require the build hook secret")).toBeLessThan(
      stepIndex("db:migrate:production"),
    );
  });

  it("refuses to migrate or deploy unless CI on main HEAD concluded success", () => {
    const step = findStep("Require green CI on main HEAD");
    expect(step).toContain("gh api");
    expect(step).toContain("workflows/ci.yml/runs?head_sha=$HEAD_SHA");
    expect(step).toContain('[ "$conclusion" != "success" ]');
    expect(step).toContain("exit 1");
    expect(stepIndex("Require green CI on main HEAD")).toBeLessThan(
      stepIndex("db:migrate:production"),
    );
    expect(workflow).toMatch(/^ {2}actions: read$/m);
  });

  it("migrates with the production key before calling the hook", () => {
    const migrate = findStep("db:migrate:production");
    expect(migrate).toContain(
      "DOTENV_PRIVATE_KEY_PRODUCTION: ${{ secrets.DOTENV_PRIVATE_KEY_PRODUCTION }}",
    );
    expect(stepIndex("db:migrate:production")).toBeLessThan(
      stepIndex("Trigger Netlify production build hook"),
    );
  });

  it("never continues past a failed migration", () => {
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toMatch(/if:\s*(always|failure)\(\)/);
  });

  it("calls the hook with curl --fail and a trigger title per event", () => {
    const step = findStep("Trigger Netlify production build hook");
    expect(step).toMatch(
      /curl --fail --silent --show-error --max-time 30 -X POST -d '\{\}'/,
    );
    expect(step).toContain("Manual+production+deploy");
    expect(step).toContain("Weekly+production+deploy");
  });

  it("only passes secrets through env, never inline interpolation", () => {
    const secretLines = workflow
      .split("\n")
      .filter((line) => line.includes("${{ secrets."));
    expect(secretLines.length).toBeGreaterThan(0);
    secretLines.forEach((line) => {
      expect(line).toMatch(/^\s+[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}\s*$/);
    });
  });
});

describe("ci.yml", () => {
  it("no longer migrates production on push to main", () => {
    const ci = readFileSync(CI_WORKFLOW_PATH, "utf8");
    expect(ci).not.toContain("migrate-production");
    expect(ci).not.toContain("db:migrate:production");
    expect(ci).not.toContain("DOTENV_PRIVATE_KEY_PRODUCTION");
  });
});
