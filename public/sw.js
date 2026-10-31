/**
 * Habitability Walkthrough Companion — service worker (REQ-007, REQ-010, REQ-013).
 *
 * App-shell precache + offline fallback. Caches the application shell and
 * static assets ONLY. Never caches, stores, or serves:
 * - POST requests or any `/api/*` traffic (analysis payloads, provider
 *   responses, validation results),
 * - IndexedDB evidence rows or canonical media bytes (object URLs and
 *   data URLs never reach the worker; media lives in IndexedDB only),
 * - credentials, API keys, or provider request/response bodies.
 *
 * Offline launch serves the cached `/` shell, which boots the normal page and
 * restores saved local progress from IndexedDB (or explains its absence).
 * While offline, new analyses are never synthesized here: queueing and the
 * explicit reconnect retry live in `src/features/walkthrough/offline.ts` and
 * the session manager, with pending-only semantics. No background sync of
 * analysis results in this phase.
 */

/* global self, caches, fetch, Response, URL */

var SHELL_CACHE = "habitability-walkthrough-shell-v3";
var APP_CACHE_PREFIX = "habitability-walkthrough-";

/** Core shell: required for an honest offline launch. */
var CORE_PRECACHE = ["/", "/manifest.webmanifest"];

/**
 * Best-effort precache (rights-cleared install icons). Missing icon files
 * must never break offline boot, so these are cached individually and every
 * failure is tolerated.
 */
var ICON_PRECACHE = [
  "/icons/icon-192.svg",
  "/icons/icon-512.svg",
  "/icons/icon-maskable-512.svg",
];

/**
 * Best-effort precache (self-hosted Public Sans subsets). Same-origin shell
 * typography: failures are tolerated so a missing font never breaks boot —
 * every surface falls back to the system stack by design.
 */
var FONT_PRECACHE = [
  "/fonts/public-sans-latin-400-normal.woff2",
  "/fonts/public-sans-latin-600-normal.woff2",
  "/fonts/public-sans-latin-700-normal.woff2",
];

function isApiRequest(url) {
  return url.pathname.indexOf("/api/") === 0;
}

function isShellAsset(url) {
  if (url.pathname === "/manifest.webmanifest") return true;
  if (url.pathname.indexOf("/_next/static/") === 0) return true;
  if (url.pathname.indexOf("/icons/") === 0) return true;
  if (url.pathname.indexOf("/fonts/") === 0) return true;
  return false;
}

function isNavigationRequest(request) {
  if (request.mode === "navigate") return true;
  if (typeof request.destination === "string" && request.destination === "document") {
    return true;
  }
  return false;
}

function offlineFallbackHtml() {
  return (
    "<!doctype html>" +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "<title>Offline — Habitability Walkthrough Companion</title>" +
    "<style>body{font-family:system-ui,sans-serif;margin:2rem;line-height:1.6}" +
    ".card{max-width:36rem;border:.125rem solid #5b6b82;border-radius:.625rem;padding:1rem 1.25rem}" +
    "</style></head><body><main><div class=\"card\" role=\"alert\">" +
    "<h1>You are offline</h1>" +
    "<p>The walkthrough shell could not be reached and no cached copy is " +
    "available yet. Reconnect, reload once while online so the shell can be " +
    "cached, and your saved local progress will restore. No analysis ran " +
    "while offline and nothing was uploaded.</p>" +
    "</div></main></body></html>"
  );
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(function (cache) {
        return cache.addAll(CORE_PRECACHE);
      })
      .then(function () {
        return caches.open(SHELL_CACHE);
      })
      .then(function (cache) {
        return Promise.allSettled(
          ICON_PRECACHE.concat(FONT_PRECACHE).map(function (url) {
            return cache.add(url);
          }),
        );
      })
      .then(function () {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (names) {
        return Promise.all(
          names.map(function (name) {
            // CacheStorage is shared by every app on this origin. Remove only
            // caches owned by this PWA so activation cannot erase unrelated
            // same-origin offline data.
            if (name.indexOf(APP_CACHE_PREFIX) === 0 && name !== SHELL_CACHE) {
              return caches.delete(name);
            }
            return Promise.resolve(false);
          }),
        );
      })
      .then(function () {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  // Never intercept non-GET work: analysis uploads, deletions, and any
  // provider traffic stay on the network and never enter the cache.
  if (request.method !== "GET") return;
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Cross-origin requests (fonts, CDNs) are left alone: the shell must not
  // retain third-party bytes.
  if (url.origin !== self.location.origin) return;
  // API traffic is never cached and never served from cache.
  if (isApiRequest(url)) return;

  // Navigations: network first so the worker sees fresh progress, falling
  // back to the cached app shell (which restores IndexedDB progress), and
  // finally to an honest offline notice.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request).then(
        function (response) {
          return response;
        },
        function () {
          return caches.match("/", { ignoreSearch: false }).then(function (cached) {
            if (cached) return cached;
            return new Response(offlineFallbackHtml(), {
              status: 503,
              headers: { "Content-Type": "text/html; charset=utf-8" },
            });
          });
        },
      ),
    );
    return;
  }

  // Versioned shell assets and install icons: cache first, refresh in the
  // background. Anything else same-origin (including media-like paths) goes
  // to the network only and is never cached.
  if (isShellAsset(url)) {
    var network = fetch(request).then(function (response) {
      if (response && response.status === 200) {
        return caches.open(SHELL_CACHE).then(function (cache) {
          return cache.put(request, response.clone());
        }).then(function () {
          return response;
        });
      }
      return response;
    });
    // Keep the worker alive until the static-shell cache write finishes,
    // including when a cached response lets the page return immediately.
    event.waitUntil(network.then(function () {}, function () {}));
    event.respondWith(
      caches.match(request).then(function (cached) {
        return cached || network;
      }),
    );
  }
});
