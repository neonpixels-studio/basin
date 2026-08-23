import { pathToFileURL } from "node:url";

// True when the given module is the process entrypoint (`node scripts/x.ts`)
// rather than imported by a test or another module — so a backfill's main()
// runs on direct invocation but stays inert (and unit-testable) when imported.
// Pass the caller's import.meta.url; the check must resolve against the caller,
// not this helper.
export function isDirectInvocation(moduleUrl: string): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }
  return moduleUrl === pathToFileURL(entrypoint).href;
}
