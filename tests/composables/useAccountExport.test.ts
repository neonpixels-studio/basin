import { describe, it, expect, vi, beforeEach } from "vitest";
import { useAccountExport } from "~/composables/useAccountExport";

const mockFetch = vi.fn();
vi.stubGlobal("$fetch", mockFetch);

describe("useAccountExport", () => {
  // Reset only $fetch — vi.resetAllMocks() would also strip the global useAuth
  // stub that useAuthHeaders (and therefore useAccountExport) depends on. Kept
  // as a braced body so the returned mock isn't taken as an after-each hook.
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("sends the bearer auth header to the account export endpoint", async () => {
    mockFetch.mockResolvedValueOnce({ schemaVersion: 1 });
    vi.stubGlobal("useAuth", () => ({
      getToken: { value: vi.fn().mockResolvedValue("token-abc") },
    }));

    const { exportData } = useAccountExport();
    await exportData();

    expect(mockFetch).toHaveBeenCalledWith("/api/account/export", {
      headers: { Authorization: "Bearer token-abc" },
    });
    vi.unstubAllGlobals();
    vi.stubGlobal("$fetch", mockFetch);
  });

  it("downloads the response as a named JSON file", async () => {
    mockFetch.mockResolvedValueOnce({ schemaVersion: 1 });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:mock");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});
    const createElement = vi.spyOn(document, "createElement");

    const { exportData, error } = useAccountExport();
    await exportData();

    expect(error.value).toBeNull();
    expect(createObjectURL).toHaveBeenCalledOnce();
    const anchor = createElement.mock.results.find(
      (result) => (result.value as HTMLElement).tagName === "A",
    )?.value as HTMLAnchorElement;
    expect(anchor.download).toBe("reader-data-export.json");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");

    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
    createElement.mockRestore();
  });

  it("sets error when the export request fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("server error"));
    const { error, exportData } = useAccountExport();
    await exportData();
    expect(error.value).toBeTruthy();
  });

  it("clears a previous error on a successful export", async () => {
    const { error, exportData } = useAccountExport();
    mockFetch.mockRejectedValueOnce(new Error("oops"));
    await exportData();
    expect(error.value).toBeTruthy();
    mockFetch.mockResolvedValueOnce({ schemaVersion: 1 });
    await exportData();
    expect(error.value).toBeNull();
  });

  it("toggles exporting to true during the request and false after", async () => {
    let resolveFetch: (_value: unknown) => void = () => {};
    mockFetch.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { exporting, exportData } = useAccountExport();
    const promise = exportData();
    expect(exporting.value).toBe(true);
    resolveFetch({ schemaVersion: 1 });
    await promise;
    expect(exporting.value).toBe(false);
  });
});
