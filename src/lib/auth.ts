import { cookies } from "next/headers";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Cookie-aware authentication helpers for Server Components, Server Actions and
 * Route Handlers. The token primitives live in `session.ts` so `proxy.ts` can
 * share them without pulling in `next/headers`.
 */

export async function isAuthenticated(): Promise<boolean> {
  // `cookies()` is async as of Next.js 16 — synchronous access was removed.
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * Guard for every server-side data boundary.
 *
 * `proxy.ts` redirects unauthenticated browsers, but the Next.js proxy docs are
 * explicit that Server Functions are handled as POST requests to the route where
 * they are used, so a matcher change or a refactor that moves a Server Function
 * can silently remove proxy coverage. Every server action and route handler that
 * touches data therefore calls this directly rather than trusting the proxy.
 */
export async function requireAuth(): Promise<void> {
  if (!(await isAuthenticated())) {
    throw new Error("Unauthorized");
  }
}
