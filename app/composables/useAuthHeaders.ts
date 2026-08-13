/* useAuthHeaders — builds the Clerk bearer-token Authorization header shared by
   the composables that call authenticated API routes (billing, settings,
   account export). Extracted so the identical header-construction logic lives
   in one place rather than being copied per composable. */

export function useAuthHeaders() {
  const { getToken } = useAuth();

  async function buildAuthHeaders(): Promise<Record<string, string>> {
    const token = await getToken.value();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  return { buildAuthHeaders };
}
