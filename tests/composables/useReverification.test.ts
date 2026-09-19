import { describe, it, expect, vi, beforeEach } from "vitest";
import { ref } from "vue";
import {
  useReverification,
  isReverificationCancelledError,
} from "~/composables/useReverification";

// Mirrors the real $fetch failure: the reverification code is nested at
// `error.data.data.code` (Nitro serializes createError({ data }) as {...,data}).
const reverificationError = () =>
  Object.assign(new Error("reverify"), {
    statusCode: 403,
    data: { data: { code: "reverification_required" } },
  });

function stubClerk(openReverification: unknown) {
  vi.stubGlobal("useClerk", () =>
    ref(
      openReverification
        ? { __internal_openReverification: openReverification }
        : null,
    ),
  );
}

describe("useReverification", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("passes the result through when the action succeeds", async () => {
    stubClerk(vi.fn());
    const action = vi.fn().mockResolvedValue("ok");
    const { withReverification } = useReverification();
    await expect(withReverification(action)()).resolves.toBe("ok");
    expect(action).toHaveBeenCalledOnce();
  });

  it("rethrows non-reverification errors without prompting", async () => {
    const openReverification = vi.fn();
    stubClerk(openReverification);
    const action = vi.fn().mockRejectedValue(new Error("boom"));
    const { withReverification } = useReverification();
    await expect(withReverification(action)()).rejects.toThrow("boom");
    expect(openReverification).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledOnce();
  });

  it("does not prompt for a bare 403 that lacks the reverification code", async () => {
    const openReverification = vi.fn();
    stubClerk(openReverification);
    const bare403 = Object.assign(new Error("forbidden"), {
      statusCode: 403,
      data: { statusCode: 403 },
    });
    const action = vi.fn().mockRejectedValue(bare403);
    const { withReverification } = useReverification();
    await expect(withReverification(action)()).rejects.toBe(bare403);
    expect(openReverification).not.toHaveBeenCalled();
    expect(action).toHaveBeenCalledOnce();
  });

  it("prompts then retries the action once on a reverification error", async () => {
    const openReverification = vi.fn((props) => props.afterVerification());
    stubClerk(openReverification);
    const action = vi
      .fn()
      .mockRejectedValueOnce(reverificationError())
      .mockResolvedValueOnce("done");
    const { withReverification } = useReverification();
    await expect(withReverification(action)()).resolves.toBe("done");
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("rejects with a cancellation error when the user backs out", async () => {
    const openReverification = vi.fn((props) =>
      props.afterVerificationCancelled(),
    );
    stubClerk(openReverification);
    const action = vi.fn().mockRejectedValue(reverificationError());
    const { withReverification } = useReverification();
    await withReverification(action)().catch((caughtError) => {
      expect(isReverificationCancelledError(caughtError)).toBe(true);
    });
    expect.assertions(1);
  });

  it("rejects when Clerk is not loaded", async () => {
    stubClerk(null);
    const action = vi.fn().mockRejectedValue(reverificationError());
    const { withReverification } = useReverification();
    await expect(withReverification(action)()).rejects.toThrow(/unavailable/i);
  });

  it("rejects when the internal reverification method is missing", async () => {
    // A Clerk minor could rename the unstable __internal_openReverification.
    vi.stubGlobal("useClerk", () => ref({}));
    const action = vi.fn().mockRejectedValue(reverificationError());
    const { withReverification } = useReverification();
    await expect(withReverification(action)()).rejects.toThrow(/unavailable/i);
  });
});
