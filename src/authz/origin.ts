/**
 * Cookie-authenticated requests must come from this app's origin. The demo
 * has no CSRF token; SameSite=Lax is not enough on its own for a POST that
 * executes a consequential action.
 */
export function isSameOriginRequest(request: Request): boolean {
  const allowed = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === allowed;
  }

  const referer = request.headers.get("referer");
  if (!referer) {
    return false;
  }

  try {
    return new URL(referer).origin === allowed;
  } catch {
    return false;
  }
}
