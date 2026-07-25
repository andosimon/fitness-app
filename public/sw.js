/*
 * Service worker for offline page loads.
 *
 * Hand-written rather than generated. The usual choice, Serwist, requires a
 * webpack configuration, and Next.js 16 builds with Turbopack by default — a
 * custom webpack config now makes `next build` fail outright. Files in public/
 * are served verbatim and need no build integration, so this sidesteps the
 * problem entirely.
 *
 * IndexedDB already protects data once a page is open. This exists so the app
 * *opens* at all when there's no signal.
 */

const VERSION = "v1";
const STATIC_CACHE = `static-${VERSION}`;
const PAGE_CACHE = `pages-${VERSION}`;
const OFFLINE_URL = "/offline.html";

const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      // Apply updates promptly. Safe here because all training data lives in
      // IndexedDB, so swapping the worker mid-session cannot lose a logged set.
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Immutable, content-hashed build output — safe to serve from cache first. */
function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    /\.(?:png|jpg|jpeg|svg|webp|ico|woff2?)$/.test(url.pathname)
  );
}

/**
 * Only cache genuine page responses.
 *
 * A redirect must never be cached as a page: the gate 307s to /login when the
 * session expires, and caching that would pin the app to the login screen even
 * after signing back in.
 */
function isCacheablePage(response) {
  return response && response.ok && response.type === "basic" && !response.redirected;
}

async function handleNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheablePage(response)) {
      const cache = await caches.open(PAGE_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline: serve this page from a previous visit, else the fallback.
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    const fallback = await caches.match(OFFLINE_URL);
    if (fallback) return fallback;
    return new Response("Offline", { status: 503, headers: { "content-type": "text/plain" } });
  }
}

async function handleStatic(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(STATIC_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Mutations and anything non-GET must always hit the network.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache the sync endpoint or any API response — stale training data
  // served from cache would be worse than an honest failure.
  if (url.pathname.startsWith("/api/")) return;

  // React Server Component payloads are request-specific; serving a stale one
  // produces confusing partial updates. Let them fail and fall back to a full
  // navigation, which the page cache can satisfy.
  if (url.searchParams.has("_rsc")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(handleStatic(request));
  }
});
