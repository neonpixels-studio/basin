import { mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it, expect, afterEach, vi } from "vitest";
import { isDirectInvocation } from "../../scripts/isDirectInvocation";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubEntrypoint(entrypointPath: string): void {
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", entrypointPath]);
}

// Node always resolves symlinks when building import.meta.url, so mirror that
// here — the tmp dir itself lives under a symlink (/var -> /private/var) on
// macOS, which is exactly the mismatch the helper's realpath guards against.
function moduleUrlFor(path: string): string {
  return pathToFileURL(realpathSync(path)).href;
}

describe("isDirectInvocation", () => {
  it("is true when the module url matches the entrypoint", () => {
    const scriptPath = join(
      mkdtempSync(join(tmpdir(), "direct-")),
      "script.ts",
    );
    writeFileSync(scriptPath, "");
    stubEntrypoint(scriptPath);

    expect(isDirectInvocation(moduleUrlFor(scriptPath))).toBe(true);
  });

  it("is true when the entrypoint is reached through a symlink (argv is not realpath'd)", () => {
    const directory = mkdtempSync(join(tmpdir(), "direct-"));
    const realPath = join(directory, "script.ts");
    const symlinkPath = join(directory, "script-link.ts");
    writeFileSync(realPath, "");
    symlinkSync(realPath, symlinkPath);

    // node is invoked via the symlink, but import.meta.url resolves the symlink.
    stubEntrypoint(symlinkPath);

    expect(isDirectInvocation(moduleUrlFor(realPath))).toBe(true);
  });

  it("is false when imported (module url differs from the entrypoint)", () => {
    const directory = mkdtempSync(join(tmpdir(), "direct-"));
    const entrypoint = join(directory, "test-runner.ts");
    const otherModule = join(directory, "imported.ts");
    writeFileSync(entrypoint, "");
    writeFileSync(otherModule, "");
    stubEntrypoint(entrypoint);

    expect(isDirectInvocation(moduleUrlFor(otherModule))).toBe(false);
  });

  it("is false when there is no entrypoint", () => {
    vi.spyOn(process, "argv", "get").mockReturnValue(["node"]);

    expect(isDirectInvocation("file:///anything.ts")).toBe(false);
  });
});
