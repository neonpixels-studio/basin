/* useReverification — Vue equivalent of Clerk's React `useReverification` hook,
   which @clerk/vue does not export. Wraps an async action so that when the
   server responds "reverification required", Clerk's verification modal opens;
   on success the action is retried once (now carrying a freshly-verified
   session) and on cancel the wrapped call rejects with a
   ReverificationCancelledError so the caller can treat it as a benign back-out. */

// Matches the server's REVERIFICATION_REQUIRED_CODE in
// server/utils/reverification.ts — the cross-boundary contract for this gate.
export const REVERIFICATION_REQUIRED_CODE = "reverification_required";

export class ReverificationCancelledError extends Error {
  constructor() {
    super("Reverification was cancelled.");
    this.name = "ReverificationCancelledError";
  }
}

export function isReverificationCancelledError(
  input: unknown,
): input is ReverificationCancelledError {
  return input instanceof ReverificationCancelledError;
}

type ReverificationFetchError = {
  statusCode?: number;
  status?: number;
  data?: { code?: string } | null;
};

function needsReverification(caughtError: unknown): boolean {
  const error = caughtError as ReverificationFetchError | null;
  if (!error) {
    return false;
  }
  if (error.data?.code === REVERIFICATION_REQUIRED_CODE) {
    return true;
  }
  return (error.statusCode ?? error.status) === 403;
}

export function useReverification() {
  const clerk = useClerk();

  function promptReverification(): Promise<void> {
    return new Promise((resolve, reject) => {
      const instance = clerk.value;
      if (!instance) {
        reject(new Error("Clerk is not loaded; cannot reverify."));
        return;
      }
      // `__internal_openReverification` is the same entry point Clerk's own
      // React useReverification uses; @clerk/vue exposes no public wrapper.
      instance.__internal_openReverification({
        afterVerification: () => resolve(),
        afterVerificationCancelled: () =>
          reject(new ReverificationCancelledError()),
      });
    });
  }

  // Returns an enhanced action: run it, and if the server demands a fresh
  // reverification, prompt for it and retry the action exactly once.
  function withReverification<Args extends unknown[], Result>(
    action: (..._args: Args) => Promise<Result>,
  ): (..._args: Args) => Promise<Result> {
    return async (...args: Args): Promise<Result> => {
      try {
        return await action(...args);
      } catch (caughtError) {
        if (!needsReverification(caughtError)) {
          throw caughtError;
        }
        await promptReverification();
        return action(...args);
      }
    };
  }

  return { withReverification };
}
