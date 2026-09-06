import { PUBLIC_PATHS, normalizePath } from "~/utils/publicPaths";

export default defineNuxtRouteMiddleware((to) => {
  const { isSignedIn } = useAuth();
  const path = normalizePath(to.path);

  if (isSignedIn.value && (path === "/" || path === "/login")) {
    return navigateTo("/dashboard");
  }

  if (!isSignedIn.value && !PUBLIC_PATHS.includes(path) && path !== "/login") {
    return navigateTo("/login");
  }
});
