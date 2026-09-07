import { MARKETING_ROUTES } from "#shared/utils/marketingRoutes";

export default defineNuxtRouteMiddleware((to) => {
  const { isSignedIn } = useAuth();
  const path = to.path.replace(/(.)\/$/, "$1");

  if (isSignedIn.value && (path === "/" || path === "/login")) {
    return navigateTo("/dashboard");
  }

  if (
    !isSignedIn.value &&
    !MARKETING_ROUTES.includes(path) &&
    path !== "/login"
  ) {
    return navigateTo("/login");
  }
});
