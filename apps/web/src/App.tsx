import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { AppStoreProvider, useAppStore } from "@smriti/app-core/react";
import { TooltipProvider, UIProvider } from "@smriti/ui-web";
import type { Locale } from "@smriti/i18n";
import { ServicesProvider, useServices } from "./boot/context";
import type { Services } from "./boot/services";
import { I18nProvider, useI18n } from "./lib/i18n";
import { useTheme } from "./lib/theme";
import { createAppRouter } from "./router";
import altText from "./assets/alt-text.json";

const ALT = altText as Record<string, { en: string; hi: string }>;
const altFor = (name: string, locale: Locale) => ALT[name]?.[locale];

/** `data-exam` accent from the student's main exam profile (`jee-main-2027` → jee). */
function examKey(profileId: string | undefined): "jee" | "neet" | "upsc" | "ssc" | undefined {
  if (!profileId) return undefined;
  const k = profileId.split("-")[0];
  return k === "jee" || k === "neet" || k === "upsc" || k === "ssc" ? k : undefined;
}

function Themed({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();
  const reduced = useTheme((s) => s.reducedMotion);
  const exam = useAppStore((s) => s.profile?.exam_profile_ids[0]);
  useEffect(() => {
    const k = examKey(exam);
    if (k) document.documentElement.setAttribute("data-exam", k);
    else document.documentElement.removeAttribute("data-exam");
  }, [exam]);
  return (
    <UIProvider locale={locale} altText={altFor} reducedMotion={reduced === "on" ? true : undefined}>
      <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
    </UIProvider>
  );
}

function Routes({ queryClient }: { queryClient: QueryClient }) {
  const services = useServices();
  const [router] = useState(() => createAppRouter({ services, queryClient }));
  return <RouterProvider router={router} />;
}

export function App({ services, queryClient }: { services: Services; queryClient?: QueryClient }) {
  const [qc] = useState(
    () => queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, networkMode: "offlineFirst" } } }),
  );
  return (
    <ServicesProvider services={services}>
      <AppStoreProvider store={services.store}>
        <QueryClientProvider client={qc}>
          <I18nProvider
            brand={services.variant.appName}
            onLocaleChange={(l) => {
              services.analytics.track("language_changed", { scope: "app", locale: l });
            }}
          >
            <Themed>
              <Routes queryClient={qc} />
            </Themed>
          </I18nProvider>
        </QueryClientProvider>
      </AppStoreProvider>
    </ServicesProvider>
  );
}
