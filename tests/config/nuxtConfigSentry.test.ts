// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// Imports the real nuxt.config.ts with defineNuxtConfig stubbed to identity so
// the Sentry block can be asserted without booting Nuxt.
async function loadNuxtConfig() {
  vi.resetModules();
  vi.stubGlobal("defineNuxtConfig", (config: unknown) => config);
  const module = await import("../../nuxt.config");

  return module.default as {
    sourcemap: { client: string };
    sentry: {
      sourcemaps?: { filesToDeleteAfterUpload?: string[] };
      sourceMapsUploadOptions?: unknown;
    };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nuxt.config Sentry source maps", () => {
  it("emits hidden client source maps for upload", async () => {
    const config = await loadNuxtConfig();

    expect(config.sourcemap.client).toBe("hidden");
  });

  it("deletes every .map file from dist after upload so none are served publicly", async () => {
    const config = await loadNuxtConfig();

    expect(config.sentry.sourcemaps?.filesToDeleteAfterUpload).toEqual([
      "dist/**/*.map",
    ]);
  });

  it("does not use the removed sourceMapsUploadOptions key", async () => {
    const config = await loadNuxtConfig();

    expect(config.sentry.sourceMapsUploadOptions).toBeUndefined();
  });
});
