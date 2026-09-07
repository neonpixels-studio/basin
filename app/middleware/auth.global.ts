import {
  MARKETING_ROUTES,
  normalizeRoutePath,
} from "#shared/utils/marketingRoutes";

export default defineNuxtRouteMiddleware((to) => {
  const { isSignedIn } = useAuth();
  const path = normalizeRoutePath(to.path);

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
