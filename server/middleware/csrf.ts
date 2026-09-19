import {
  requiresOriginCheck,
  isRequestOriginAllowed,
} from "../utils/originCheck";

const HTTP_FORBIDDEN = 403;

// Fleet-wide CSRF/origin guard for state-changing API routes. Runs after
// server/middleware/auth.ts ("auth" < "csrf" by filename, the order Nitro
// uses), so a rejected cross-site request is turned away before rateLimit and
// the route handler do any real work. The classification lives in
// server/utils/originCheck.ts so it can be unit-tested without HTTP plumbing.
export default defineEventHandler((event) => {
  const requestUrl = getRequestURL(event, {
    xForwardedHost: true,
    xForwardedProto: true,
  });

  if (!requiresOriginCheck(event.method, requestUrl.pathname)) {
    return;
  }

  const allowed = isRequestOriginAllowed({
    origin: getHeader(event, "origin") ?? null,
    secFetchSite: getHeader(event, "sec-fetch-site") ?? null,
    targetOrigin: requestUrl.origin,
  });
  if (allowed) {
    return;
  }

  throw createError({
    statusCode: HTTP_FORBIDDEN,
    statusMessage: "Cross-origin request rejected",
  });
});
