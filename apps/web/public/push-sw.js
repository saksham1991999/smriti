/*
 * Web Push in the service worker (NTF-01 on web), imported by the generated Workbox worker.
 * The server sends `{ title, body, data: { kind, template_id, url, id } }` (apps/api push.py).
 * A tap opens `/notification`, which maps the deep link onto the app's routes and tells the
 * server the push was opened. No action buttons on web (NTF-01 "Web").
 */
/* eslint-env serviceworker */
self.addEventListener("push", (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch (e) {
    msg = {};
  }
  const data = msg.data || {};
  if (!msg.title || !msg.body) return;
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      icon: "/assets/app-icon.webp",
      badge: "/assets/app-icon.webp",
      tag: data.kind || undefined,
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const params = new URLSearchParams();
  if (data.url) params.set("to", data.url);
  if (data.id) params.set("id", data.id);
  if (data.template_id) params.set("t", data.template_id);
  const target = "/notification?" + params.toString();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w && "navigate" in w) return w.navigate(target).then((c) => (c ? c.focus() : undefined));
      }
      return self.clients.openWindow(target);
    }),
  );
});
