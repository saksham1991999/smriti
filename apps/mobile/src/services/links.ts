/**
 * Where a notification's deep link opens in this app. Server pushes carry paths from
 * apps/api services/notify.py (`/pro`, `/garden`, `/books/{id}`, ...); local habit reminders carry
 * the paths app-core plans. Links to screens the app does not have yet land on Learn.
 */
const KNOWN = ['/learn', '/practice', '/labs', '/me', '/memory', '/mocks', '/tutor', '/challenge', '/settings', '/paywall'];

export function routeForLink(url: string | null): string {
  if (!url) return '/learn';
  let path = url;
  const scheme = /^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/[^?#]*)?/i.exec(url);
  if (scheme) path = scheme[1] ?? '/';
  path = path.split(/[?#]/)[0] ?? '/';
  if (path.startsWith('/pro')) return '/paywall';
  if (path === '/garden') return '/me';
  if (path.startsWith('/lesson/') || path.startsWith('/subject/') || path.startsWith('/chapter/') || path.startsWith('/lab/')) return path;
  return KNOWN.includes(path) ? path : '/learn';
}
