import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

// Guards the silent failure mode that shipped a broken production build: any
// key present in the committed `.env` but missing from a deploy environment's
// dotenvx file gets `.env`'s *ciphertext* injected into that build.
//
// Why that happens: `nuxt build` loads the repo-root `.env` itself (c12's
// setupDotenv), which fills only keys not already in process.env and leaves
// pre-set ones alone. So `dotenvx run -f .env.production -- nuxt build` gives
// dotenvx first pass at every key it holds, and Nuxt then backfills whatever
// is left from `.env` — a file that is committed and still encrypted, with no
// DOTENV_PRIVATE_KEY available in CI to decrypt it. The value each missing key
// lands on is therefore the literal string "encrypted:BASE64...".
//
// That is not an empty value the build guards catch as missing: for
// NUXT_SITE_URL it parsed as a URL with protocol "encrypted:" and failed
// nuxt.config.ts's site URL guard with a misleading "must use the http or
// https protocol" — and a key with no build guard at all would have deployed
// silently with ciphertext as its value.
//
// Only the `.env` -> deploy-file direction is checked. The reverse is
// legitimate: `.env.production` intentionally carries prod-only keys
// (NUXT_PUBLIC_GA_MEASUREMENT_ID, NUXT_DISABLE_SIGNUPS, the Sentry release
// upload token) that local dev has no use for, and a key absent from `.env`
// has nothing to leak into anyone's build.
const SOURCE_ENV_FILE = ".env";

// The two files that feed a `nuxt build` on Netlify (npm run build and
// build:dev), where a ciphertext value gets baked into a deployed bundle.
//
// .env.e2e is deliberately not checked: its server env is assembled by
// playwright.config.ts's webServer.env, which injects the keys that file omits
// (DATABASE_URL, NUXT_DATABASE_URL, SENTRY_DSN) explicitly for exactly this
// reason — see the comment on SENTRY_DSN there. Those keys are already set in
// process.env before `nuxt dev` starts, so c12 leaves them alone and the
// ciphertext never lands. Adding .env.e2e here would report that intentional
// split as drift.
const DEPLOY_ENV_FILES = [".env.dev", ".env.production"];

// dotenvx writes one public key per file, named for that file's environment
// (DOTENV_PUBLIC_KEY in .env, DOTENV_PUBLIC_KEY_PRODUCTION in .env.production,
// and so on), so these never match across files by design and are not values
// the app reads. Excluded rather than special-cased per file.
const DOTENVX_PUBLIC_KEY_PREFIX = "DOTENV_PUBLIC_KEY";

// Matches `KEY=` at the start of a line, which is the only shape dotenvx
// writes. Deliberately not a full dotenv parser: this test needs key names,
// not values, and the values here are ciphertext blobs that can contain
// anything.
const ENV_KEY_PATTERN = /^([A-Z][A-Z0-9_]*)=/;

function readEnvFileKeys(fileName: string): Set<string> {
  const contents = readFileSync(resolve(process.cwd(), fileName), "utf8");
  const keys = contents
    .split("\n")
    .map((line) => line.match(ENV_KEY_PATTERN)?.[1])
    .filter((key): key is string => Boolean(key))
    .filter((key) => !key.startsWith(DOTENVX_PUBLIC_KEY_PREFIX));

  // An empty key set means the regex stopped matching what dotenvx writes (or
  // the file moved), which would make every assertion below vacuously pass.
  if (keys.length === 0) {
    throw new Error(
      `Parsed no environment keys out of ${fileName} — update ENV_KEY_PATTERN ` +
        "if the dotenvx file format changed, otherwise this guard silently passes.",
    );
  }

  return new Set(keys);
}

describe("dotenvx env file key parity", () => {
  const sourceKeys = readEnvFileKeys(SOURCE_ENV_FILE);

  it.each(DEPLOY_ENV_FILES)(
    "%s defines every key present in .env",
    (deployEnvFile) => {
      const deployKeys = readEnvFileKeys(deployEnvFile);
      const missingKeys = [...sourceKeys]
        .filter((key) => !deployKeys.has(key))
        .sort();

      expect(
        missingKeys,
        `${deployEnvFile} is missing ${missingKeys.join(", ")} — a build using ` +
          `it would inherit ${SOURCE_ENV_FILE}'s encrypted ciphertext as the ` +
          "literal value for those keys. Add them with " +
          `\`dotenvx set <KEY> "<value>" -f ${deployEnvFile}\`.`,
      ).toEqual([]);
    },
  );
});
