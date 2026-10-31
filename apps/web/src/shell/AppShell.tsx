import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  IconButton,
  Illustration,
  SidebarNav,
  StreakPill,
  TabBar,
  Text,
  type NavItem,
} from "@smriti/ui-web";
import { useStreak } from "@smriti/app-core/react";
import { useServices } from "../boot/context";
import { useI18n } from "../lib/i18n";
import { resolvedDark, useTheme } from "../lib/theme";

const TABS = [
  { key: "learn", to: "/learn", icon: "House", label: "learn:WEB-01.tab_learn" },
  { key: "labs", to: "/labs", icon: "Flask", label: "learn:WEB-01.tab_labs" },
  { key: "practice", to: "/practice", icon: "Exam", label: "learn:WEB-01.tab_practice" },
  { key: "me", to: "/me", icon: "UserCircle", label: "learn:WEB-01.tab_me" },
] as const;

/** EN/HI and light/Night Colour switches (WEB-01), on every shell screen. */
export function LocaleThemeToggles({ className }: { className?: string }) {
  const { t, locale, setLocale } = useI18n();
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const s = useServices();
  const dark = resolvedDark(mode);
  return (
    <div className={`flex items-center gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setLocale(locale === "en" ? "hi" : "en")}
        aria-label={locale === "en" ? t("learn:WEB-01.language_button_a11y") : undefined}
        lang={locale === "en" ? "hi" : "en"}
        data-testid="locale-toggle"
        className="h-10 rounded-full px-3 text-label font-bold text-primary-text outline-none hover:bg-surface-sunken focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {locale === "en" ? t("learn:WEB-01.language_button") : "English"}
      </button>
      <IconButton
        icon={dark ? "Sun" : "Moon"}
        label={dark ? t("learn:WEB-01.theme_light_a11y") : t("learn:WEB-01.theme_dark_a11y")}
        testID="theme-toggle"
        onPress={() => {
          const next = dark ? "light" : "dark";
          setMode(next);
          s.analytics.track("theme_changed", { mode: next });
        }}
      />
    </div>
  );
}

/** The four-tab shell (R46): bottom tabs under 768 px, a sidebar from 768 px. */
export function AppShell() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const streak = useStreak();
  const s = useServices();
  const active = TABS.find((x) => path.startsWith(x.to))?.key ?? "learn";
  const items: NavItem[] = TABS.map((x) => ({ key: x.key, label: t(x.label), icon: x.icon }));
  const go = (key: string) => {
    const tab = TABS.find((x) => x.key === key);
    if (tab) void navigate({ to: tab.to });
  };
  return (
    <div className="flex min-h-dvh bg-bg">
      <SidebarNav
        className="sticky top-0 hidden h-dvh md:flex"
        items={items}
        activeKey={active}
        onSelect={go}
        testID="sidebar"
        header={
          <div className="mb-3 flex items-center gap-2 px-2">
            <Illustration name="logo-mark" width={36} height={36} decorative />
            <Text variant="heading" className="flex-1">
              {s.variant.appName[locale]}
            </Text>
            {streak && streak.current > 0 && <StreakPill days={streak.current} />}
          </div>
        }
        footer={<LocaleThemeToggles />}
      />
      <div className="min-w-0 flex-1 pb-[104px] md:pb-0">
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[960px] outline-none">
          <Outlet />
        </main>
      </div>
      <TabBar
        className="fixed inset-x-0 bottom-0 z-30 md:hidden"
        items={items}
        activeKey={active}
        onSelect={go}
        testID="tabbar"
      />
    </div>
  );
}
