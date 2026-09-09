import {
  MARKETING_ROUTES,
  normalizeRoutePath,
} from "#shared/utils/marketingRoutes";
import { LOGIN_PATH } from "~/utils/publicPaths";

export default defineNuxtRouteMiddleware((to) => {
  const { isSignedIn } = useAuth();
  const path = normalizeRoutePath(to.path);

  if (isSignedIn.value && (path === "/" || path === LOGIN_PATH)) {
    return navigateTo("/dashboard");
  }

  if (
    !isSignedIn.value &&
    !MARKETING_ROUTES.includes(path) &&
    path !== LOGIN_PATH
  ) {
    return navigateTo(LOGIN_PATH);
  }
});
