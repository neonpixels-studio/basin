import {
  LOGIN_PATH,
  normalizeRoutePath,
  isMarketingRoute,
} from "#shared/utils/marketingRoutes";

export default defineNuxtRouteMiddleware((to) => {
  const { isSignedIn } = useAuth();
  const path = normalizeRoutePath(to.path);

  if (isSignedIn.value && (path === "/" || path === LOGIN_PATH)) {
    return navigateTo("/dashboard");
  }

  if (!isSignedIn.value && !isMarketingRoute(path) && path !== LOGIN_PATH) {
    return navigateTo(LOGIN_PATH);
  }
});
