import { isPublicPath, normalizePath } from "~/utils/publicPaths";

export default defineNuxtRouteMiddleware((to) => {
  const { isSignedIn } = useAuth();
  const path = normalizePath(to.path);

  if (isSignedIn.value && (path === "/" || path === "/login")) {
    return navigateTo("/dashboard");
  }

  if (!isSignedIn.value && !isPublicPath(path) && path !== "/login") {
    return navigateTo("/login");
  }
});
