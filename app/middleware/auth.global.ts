import { isPublicPath, normalizePath, LOGIN_PATH } from "~/utils/publicPaths";

export default defineNuxtRouteMiddleware((to) => {
  const { isSignedIn } = useAuth();
  const path = normalizePath(to.path);

  if (isSignedIn.value && (path === "/" || path === LOGIN_PATH)) {
    return navigateTo("/dashboard");
  }

  if (!isSignedIn.value && !isPublicPath(path) && path !== LOGIN_PATH) {
    return navigateTo(LOGIN_PATH);
  }
});
