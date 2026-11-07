// Donquixote service worker — notifications only for now (the full PWA,
// offline and install work is Unit 16). Kept dependency-free and small.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
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
