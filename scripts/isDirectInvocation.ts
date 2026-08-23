import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

// True when the given module is the process entrypoint (`node scripts/x.ts`)
// rather than imported by a test or another module — so a backfill's main()
// runs on direct invocation but stays inert (and unit-testable) when imported.
// Pass the caller's import.meta.url; the check must resolve against the caller,
// not this helper.
//
// argv[1] is only path-resolved while import.meta.url has its symlinks resolved,
// so realpath the entrypoint before comparing — otherwise a symlinked path
// (e.g. macOS /tmp -> /private/tmp) makes this return false and main() silently
// no-ops. A missing/unreadable entrypoint is treated as "not direct".
export function isDirectInvocation(moduleUrl: string): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  try {
    return moduleUrl === pathToFileURL(realpathSync(entrypoint)).href;
  } catch {
    return false;
  }
}
