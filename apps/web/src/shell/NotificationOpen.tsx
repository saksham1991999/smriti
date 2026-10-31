/**
 * `/notification?to=&id=&t=`: where a tapped Web Push lands (public/push-sw.js). Tells the server
 * it was opened (R34), then replaces itself with the deep link's screen in this app.
 */
import { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServices } from "../boot/context";
import { openedDeepLink, reportOpened } from "../lib/push";
import { RouteLoading } from "./States";

export interface NotificationSearch {
  to?: string;
  id?: string;
  t?: string;
}

export function NotificationOpen() {
  const s = useServices();
  const navigate = useNavigate();
  const { to, id, t } = useSearch({ strict: false }) as NotificationSearch;
  useEffect(() => {
    if (t) s.analytics.track("notification_opened", { template_id: t, is_local: false });
    void reportOpened(s, id ?? null);
    void navigate({ href: openedDeepLink(to), replace: true });
  }, [s, navigate, to, id, t]);
  return <RouteLoading />;
}
