// Shared builder for the Clerk bearer-token header that authed composables send
// with their $fetch calls. Extracted so a new authed composable doesn't add yet
// another copy of the same three lines.
export function useAuthHeaders() {
  const { getToken } = useAuth();
  return async function authHeaders(): Promise<Record<string, string>> {
    const token = await getToken.value();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };
}
