import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

/**
 * Request gate for the whole app.
 *
 * Renamed from `middleware.ts` in Next.js 16 — the function must be named
 * `proxy` and always runs on the Node.js runtime, which is why `node:crypto`
 * token verification works here directly.
 *
 * This handles *redirecting* unauthenticated traffic. It is deliberately not the
 * only line of defence: server actions and route handlers call `requireAuth()`
 * themselves, because Server Functions are POST requests to their own route and
 * a matcher change could otherwise silently drop coverage.
 */

/**
 * Reachable without a session.
 *
 * Beyond the login flow itself, this covers the PWA surface. The service worker
 * precaches `/offline.html` at install time; if the gate redirected that request
 * the worker would cache a login page as the offline fallback, which would then
 * be shown in place of the real one.
 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  "/favicon.ico",
  "/robots.txt",
]);

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // PWA icons and other static assets under /icons must load pre-login so the
  // login screen is not visually broken.
  if (pathname.startsWith("/icons/")) return true;
  return false;
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) return NextResponse.next();

  const authenticated = verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (authenticated) return NextResponse.next();

  // API callers get a status code they can act on; browsers get a redirect.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  // Remember where they were heading so login can send them back.
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Excludes Next.js internals and static assets. Without this the gate would
  // also block CSS and JS, leaving a broken login page.
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$).*)"],
};
