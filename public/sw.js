// Donquixote service worker: push notifications, notification clicks, and a
// tiny offline shell. Kept dependency-free and small.
//
// Caching rule: only the app shell (icons, fonts, the offline page) is ever
// cached. Pages, API responses, server actions and data are never cached: a
// stale price or alert is dangerous. Pages always come from the network; if
// that fails, the offline page is shown.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `donquixote-shell-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";
const SHELL = [
  OFFLINE_URL,
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
  "/apple-touch-icon.png",
  "/badge-96.png",
  "/favicon.svg",
  "/favicon.ico",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

/** Font files from next/font: content-hashed, so safe to keep. */
const isFont = (url) => url.pathname.startsWith("/_next/static/media/") && /\.(woff2?|ttf)$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: always the network (never cached); offline page if it fails.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()),
    );
    return;
  }

  // App shell: cache first. Fonts join the shell the first time they load.
  if (SHELL.includes(url.pathname) || isFont(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        const hit = await cache.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && isFont(url)) await cache.put(req, res.clone());
        return res;
      })(),
    );
  }
  // Everything else (data, RSC, server actions, scripts): the browser's
  // default network handling, never cached here.
});

// Payload from the worker: { title, body, url, tag }.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Donquixote", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Donquixote";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      // A later push with the same tag replaces this one and alerts again.
      renotify: Boolean(data.tag),
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      // Stays until tapped, with a long vibration (Android).
      requireInteraction: true,
      vibrate: [600, 200, 600, 200, 900],
      data: { url: data.url || "/alerts" },
    }),
  );
});

// Focus an open app window and take it to the alert, or open a new one.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.url) || "/alerts";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const sameOrigin = windows.filter((w) => new URL(w.url).origin === self.location.origin);
      const client = sameOrigin.find((w) => w.focused) || sameOrigin[0];
      if (client) {
        await client.focus();
        if ("navigate" in client) {
          await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
