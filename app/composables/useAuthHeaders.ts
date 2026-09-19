/* useAuthHeaders — builds the Clerk bearer-token Authorization header shared by
   the composables that call authenticated API routes (billing, settings,
   account export). Extracted so the identical header-construction logic lives
   in one place rather than being copied per composable. */

export function useAuthHeaders() {
  const { getToken } = useAuth();

  // `skipCache` forces Clerk to mint a fresh JWT rather than return its cached
  // one (~60s leeway). Callers gating on a just-changed claim (e.g. `fva` after
  // a reverification) need this so the header reflects the new session state.
  async function buildAuthHeaders(options?: {
    skipCache?: boolean;
  }): Promise<Record<string, string>> {
    const token = await getToken.value(options);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  return { buildAuthHeaders };
}
