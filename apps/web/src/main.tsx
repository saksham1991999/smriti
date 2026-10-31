import "@smriti/ui-web/fonts.css";
import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createServices } from "./boot/services";
import { App } from "./App";
import { initialLocale, preloadLocale } from "./lib/i18n";
import type { RequestInterceptor } from "./platform/web";

async function boot() {
  let interceptor: RequestInterceptor | undefined;
  if (import.meta.env.VITE_FAKE_API === "1") {
    // Dev and e2e builds only: `@fake-api` is a throwing stub in every other mode (vite.config.ts).
    const { createBrowserFakeApi } = await import("@fake-api");
    const fake = createBrowserFakeApi(import.meta.env.VITE_API_BASE_URL as string, "/c/");
    interceptor = (req) => fake.intercept(req);
  }
  // The catalogues for one locale load alongside the local database, so the first frame has its words.
  const [services] = await Promise.all([
    createServices({ interceptor }),
    preloadLocale(initialLocale()),
  ]);
  // A guardian opening a consent link (AUTH-22) or a parent opening Parent mode on their own browser
  // isn't a student: no guest account is made for them (flow §6.10). Their own session is separate.
  const adultOnly = /^\/(guardian\/(?!ask$|handoff$|link$)[^/]+|parent(\/.*)?)\/?$/.test(
    window.location.pathname,
  );
  if (!adultOnly || (await services.auth.getSession().catch(() => null))) {
    void services.ensureSession().then(() => {
      services.sync.start();
      void services.refreshState();
    });
  }
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App services={services} />
    </StrictMode>,
  );
  if (
    "serviceWorker" in navigator &&
    import.meta.env.PROD &&
    import.meta.env.MODE === "production"
  ) {
    const { registerSW } = await import("virtual:pwa-register");
    registerSW({ immediate: true });
  }
}

void boot();
