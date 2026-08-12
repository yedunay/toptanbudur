/* Toptan Budur Admin — Push Service Worker
 *
 * Sadece bildirim push'larını handle eder; offline cache veya app-shell
 * davranışı yok (SPA Vite dev server'dan canlı geliyor).
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Yeni bildirim", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Toptan Budur";
  const options = {
    body: payload.body || "",
    icon: "/admin/toptanbudur-logo.webp",
    badge: "/admin/toptanbudur-logo.webp",
    tag: payload.tag || payload.id || undefined,
    data: { link: payload.link || "/admin/bildirimler", id: payload.id || null },
    renotify: Boolean(payload.tag),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetLink =
    (event.notification.data && event.notification.data.link) ||
    "/admin/bildirimler";
  const targetUrl = new URL(targetLink, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url === targetUrl && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
        return null;
      }),
  );
});
