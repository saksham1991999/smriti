import { useEffect, useRef } from "react";
import { Outlet } from "@tanstack/react-router";
import { Banner, Toast } from "@smriti/ui-web";
import { useServices } from "../boot/context";
import { useT } from "../lib/i18n";
import { useOnline } from "../lib/network";
import { toast, useToast } from "../lib/toast";
import { useConfig } from "../lib/queries";
import { ErrorBoundary } from "./States";

/** Skip link, offline banner, the one toast, and an error boundary around every screen. */
export function RootLayout() {
  const t = useT();
  const s = useServices();
  const online = useOnline();
  const current = useToast((x) => x.current);
  const dismiss = useToast((x) => x.dismiss);
  const wasOffline = useRef(false);
  useConfig();

  useEffect(() => {
    if (!online) wasOffline.current = true;
    else if (wasOffline.current) {
      wasOffline.current = false;
      toast.show(t("learn:WEB-01.back_online"), { icon: "CloudCheck" });
    }
  }, [online, t]);

  return (
    <>
      <a href="#main" className="skip-link rounded-md bg-primary px-4 py-3 text-label font-bold text-on-primary">
        {t("learn:WEB-01.skip_link")}
      </a>
      {!online && (
        <div className="sticky top-0 z-40 px-3 pt-2" data-testid="offline-banner">
          <Banner tone="offline" text={t("learn:WEB-01.offline_banner")} />
        </div>
      )}
      <ErrorBoundary onError={(code) => s.logger.error("ui.render_error", { code })}>
        <Outlet />
      </ErrorBoundary>
      <div className="pointer-events-none fixed inset-x-0 bottom-[96px] z-50 flex justify-center px-4 md:bottom-6">
        <div className="pointer-events-auto w-full max-w-[420px]">
          <Toast key={current?.id} open={!!current} message={current?.message ?? ""} tone={current?.tone} icon={current?.icon} onDismiss={dismiss} testID="toast" />
        </div>
      </div>
    </>
  );
}
