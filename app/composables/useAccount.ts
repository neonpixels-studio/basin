// Isolates the account-deletion request so components don't build auth headers
// or call $fetch directly. Mirrors useBilling's shape (loading/error refs plus
// an action) for consistency.
export function useAccount() {
  const { buildAuthHeaders } = useAuthHeaders();
  const { withReverification } = useReverification();
  const deleting = ref(false);
  const error = ref<string | null>(null);

  // The server rejects deletions without a recent factor verification, so wrap
  // the request in Clerk reverification: a stale session is prompted to reverify
  // and the retry rebuilds the auth header, carrying a fresh token. Headers are
  // rebuilt per attempt (inside the wrapped action) for exactly that reason.
  const requestAccountDeletion = withReverification(async () => {
    await $fetch("/api/account", {
      method: "DELETE",
      headers: await buildAuthHeaders(),
    });
  });

  // Resolves true when the account was deleted, false when the request failed
  // (with `error` set). Returning a boolean lets the caller decide whether to
  // proceed to sign-out rather than needing a try/catch.
  async function deleteAccount(): Promise<boolean> {
    deleting.value = true;
    error.value = null;
    try {
      await requestAccountDeletion();
      return true;
    } catch (caughtError) {
      if (isReverificationCancelledError(caughtError)) {
        // Not a failure: the user backed out of the verification prompt.
        error.value = "Verification cancelled — your account was not deleted.";
        return false;
      }
      // Log the real error: a mid-deletion 500 (billing may already be purged)
      // must not be indistinguishable from a benign failure in production logs.
      console.error("Account deletion request failed:", caughtError);
      const statusCode = (caughtError as { statusCode?: number })?.statusCode;
      error.value =
        statusCode === 429
          ? "Too many attempts. Please wait a minute and try again."
          : "Failed to delete your account. Please try again.";
      return false;
    } finally {
      deleting.value = false;
    }
  }

  return { deleting, error, deleteAccount };
}
