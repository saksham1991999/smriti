/**
 * Routes (TanStack Router, code-based). Every screen is a lazy chunk; the shell and the boot code
 * are the only eager parts. Onboarding, the lesson player, the paywall and sign-in are full-screen;
 * everything else sits in the four-tab shell (R46: Learn, Labs, Practice, Me).
 */
import { createRootRouteWithContext, createRoute, createRouter, lazyRouteComponent, redirect } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { Services } from "./boot/services";
import { withNamespaces } from "./lib/i18n";
import { useOnboarding } from "./lib/onboarding";
import { AppShell } from "./shell/AppShell";
import { RootLayout } from "./shell/RootLayout";
import { NotFound, RouteError, RouteLoading } from "./shell/States";

export interface RouterContext {
  services: Services;
  queryClient: QueryClient;
}

const onboarded = () => useOnboarding.getState().completedAt !== null || useOnboarding.getState().firstWinAt !== null;

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
  notFoundComponent: NotFound,
  errorComponent: RouteError,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: onboarded() ? "/learn" : "/welcome" });
  },
});

// ── Entry and onboarding (full screen) ────────────────────────────────────
const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  component: lazyRouteComponent(() => import("./screens/onboarding/Welcome"), "Welcome"),
});
export const ONBOARDING_STEPS = ["goal", "class", "birth-year", "exam-date", "level", "buddy", "plant"] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
const onboardingStepRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/$step",
  component: lazyRouteComponent(() => import("./screens/onboarding/Steps"), "OnboardingStep"),
});
const firstLessonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/first-lesson",
  component: lazyRouteComponent(withNamespaces(["memory_labs", "me_money"], () => import("./screens/lesson/LessonScreen")), "FirstLesson"),
});
const firstWinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/first-win",
  component: lazyRouteComponent(() => import("./screens/onboarding/After"), "FirstWin"),
});
const dailyGoalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/daily-goal",
  component: lazyRouteComponent(() => import("./screens/onboarding/After"), "DailyGoal"),
});
const reminderRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/reminder",
  component: lazyRouteComponent(() => import("./screens/onboarding/After"), "Reminder"),
});

// ── Full-screen flows ─────────────────────────────────────────────────────
export interface LessonSearch {
  mode?: "deep_dive" | "quick_revision";
  bite?: string;
}
const lessonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lesson/$topicId",
  validateSearch: (s: Record<string, unknown>): LessonSearch => ({
    mode: s.mode === "quick_revision" ? "quick_revision" : s.mode === "deep_dive" ? "deep_dive" : undefined,
    bite: typeof s.bite === "string" ? s.bite : undefined,
  }),
  component: lazyRouteComponent(withNamespaces(["memory_labs", "me_money"], () => import("./screens/lesson/LessonScreen")), "LessonScreen"),
});
const lessonCompleteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lesson-complete",
  component: lazyRouteComponent(withNamespaces(["me_money", "memory_labs", "auth"], () => import("./screens/lesson/LessonComplete")), "LessonComplete"),
});
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: lazyRouteComponent(withNamespaces(["memory_labs"], () => import("./screens/memory/Review")), "Review"),
});
export interface PaywallSearch {
  source?: string;
}
const paywallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro",
  validateSearch: (s: Record<string, unknown>): PaywallSearch => ({ source: typeof s.source === "string" ? s.source : undefined }),
  component: lazyRouteComponent(withNamespaces(["me_money"], () => import("./screens/me/Paywall")), "Paywall"),
});
const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro/checkout",
  component: lazyRouteComponent(withNamespaces(["me_money"], () => import("./screens/me/Paywall")), "Checkout"),
});
const proWelcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro/welcome",
  component: lazyRouteComponent(withNamespaces(["me_money"], () => import("./screens/me/Paywall")), "ProWelcome"),
});
export interface LoginSearch {
  reason?: string;
  next?: string;
}
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  validateSearch: (s: Record<string, unknown>): LoginSearch => ({
    reason: typeof s.reason === "string" ? s.reason : undefined,
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  component: lazyRouteComponent(withNamespaces(["auth"], () => import("./screens/auth/Login")), "Login"),
});
const mockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/mock",
  component: lazyRouteComponent(withNamespaces(["practice"], () => import("./screens/practice/Mock")), "MockRunner"),
});
const drillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/drill/$topicId",
  component: lazyRouteComponent(withNamespaces(["practice"], () => import("./screens/practice/Practice")), "Drill"),
});

// ── The tab shell ─────────────────────────────────────────────────────────
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: AppShell,
  beforeLoad: () => {
    if (!onboarded()) throw redirect({ to: "/welcome" });
  },
});
const homeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/learn",
  component: lazyRouteComponent(withNamespaces(["memory_labs", "practice", "auth"], () => import("./screens/home/Home")), "Home"),
});
const subjectRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/learn/subject/$subjectId",
  component: lazyRouteComponent(() => import("./screens/learn/Learn"), "SubjectScreen"),
});
const chapterRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/learn/chapter/$chapterId",
  component: lazyRouteComponent(() => import("./screens/learn/Learn"), "ChapterScreen"),
});
const topicRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/learn/topic/$topicId",
  component: lazyRouteComponent(() => import("./screens/learn/Learn"), "TopicScreen"),
});
const labsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/labs",
  component: lazyRouteComponent(withNamespaces(["memory_labs"], () => import("./screens/labs/Labs")), "LabsHub"),
});
const labRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/labs/$simId",
  component: lazyRouteComponent(withNamespaces(["memory_labs"], () => import("./screens/labs/Labs")), "LabScreen"),
});
const practiceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/practice",
  component: lazyRouteComponent(withNamespaces(["practice"], () => import("./screens/practice/Practice")), "PracticeHub"),
});
const meRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me",
  component: lazyRouteComponent(withNamespaces(["me_money", "auth"], () => import("./screens/me/Me")), "Me"),
});
const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me/settings",
  component: lazyRouteComponent(withNamespaces(["me_money", "auth"], () => import("./screens/me/Settings")), "Settings"),
});
const notificationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me/notifications",
  component: lazyRouteComponent(withNamespaces(["me_money", "auth"], () => import("./screens/me/Settings")), "NotificationSettings"),
});
const planRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me/plan",
  component: lazyRouteComponent(withNamespaces(["me_money"], () => import("./screens/me/Paywall")), "YourPlan"),
});

// ── Phase 2 and 3 (screens/phase2): full screen, outside the tab shell ─────
const feynmanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tutor/feynman/$topicId",
  validateSearch: (s: Record<string, unknown>): { concept?: string } => ({ concept: typeof s.concept === "string" ? s.concept : undefined }),
  component: lazyRouteComponent(withNamespaces(["tutor_social"], () => import("./screens/phase2/feynman/Feynman")), "Feynman"),
});
const voiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tutor/voice",
  validateSearch: (s: Record<string, unknown>): { context?: string; from?: string } => ({
    context: typeof s.context === "string" ? s.context : undefined,
    from: typeof s.from === "string" && /^\/(?!\/)/.test(s.from) ? s.from : undefined,
  }),
  component: lazyRouteComponent(withNamespaces(["tutor_social"], () => import("./screens/phase2/voice/Voice")), "Voice"),
});
const palaces = withNamespaces(["memory_labs"], () => import("./screens/phase2/palace/Palaces"));
const palaceWalk = withNamespaces(["memory_labs"], () => import("./screens/phase2/palace/Walk"));
const palacesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/memory/palaces", component: lazyRouteComponent(palaces, "Palaces") });
const newPalaceRoute = createRoute({ getParentRoute: () => rootRoute, path: "/memory/palaces/new", component: lazyRouteComponent(palaces, "NewPalace") });
const palaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memory/palaces/$palaceId",
  validateSearch: (s: Record<string, unknown>): { spot?: string } => ({ spot: typeof s.spot === "string" ? s.spot : undefined }),
  component: lazyRouteComponent(withNamespaces(["memory_labs"], () => import("./screens/phase2/palace/Builder")), "Builder"),
});
const palaceItemsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/memory/palaces/$palaceId/items", component: lazyRouteComponent(palaces, "AddPalaceItems") });
const palaceWalkRoute = createRoute({ getParentRoute: () => rootRoute, path: "/memory/palaces/$palaceId/walk", component: lazyRouteComponent(palaceWalk, "Walk") });
const palaceQuizRoute = createRoute({ getParentRoute: () => rootRoute, path: "/memory/palaces/$palaceId/quiz", component: lazyRouteComponent(palaceWalk, "Quiz") });
const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/memory/insights",
  component: lazyRouteComponent(withNamespaces(["memory_labs", "practice"], () => import("./screens/phase2/insights/Insights")), "Insights"),
});
const mixedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/mixed",
  component: lazyRouteComponent(withNamespaces(["practice"], () => import("./screens/phase2/insights/Mixed")), "Mixed"),
});
const live = withNamespaces(["practice"], () => import("./screens/phase2/live/Live"));
const liveRoute = createRoute({ getParentRoute: () => rootRoute, path: "/practice/live/$mockId", component: lazyRouteComponent(live, "LiveRoom") });
const liveBoardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/practice/live/$mockId/leaderboard", component: lazyRouteComponent(live, "LiveLeaderboard") });
const parent = withNamespaces(["me_money"], () => import("./screens/phase2/parent/Parent"));
const parentRoute = createRoute({ getParentRoute: () => rootRoute, path: "/parent", component: lazyRouteComponent(parent, "ParentHome") });
const parentReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/parent/$learnerId/report",
  validateSearch: (s: Record<string, unknown>): { week?: string } => ({ week: typeof s.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.week) ? s.week : undefined }),
  component: lazyRouteComponent(parent, "WeekReport"),
});
const parentLimitsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/parent/$learnerId/limits", component: lazyRouteComponent(parent, "TimeLimits") });
const parentConsentsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/parent/$learnerId/consents", component: lazyRouteComponent(parent, "Consents") });
const phase2Routes = [feynmanRoute, voiceRoute, palacesRoute, newPalaceRoute, palaceRoute, palaceItemsRoute, palaceWalkRoute, palaceQuizRoute, insightsRoute, mixedRoute, liveRoute, liveBoardRoute, parentRoute, parentReportRoute, parentLimitsRoute, parentConsentsRoute] as const;

const routeTree = rootRoute.addChildren([
  indexRoute,
  welcomeRoute,
  onboardingStepRoute,
  firstLessonRoute,
  firstWinRoute,
  dailyGoalRoute,
  reminderRoute,
  lessonRoute,
  lessonCompleteRoute,
  reviewRoute,
  paywallRoute,
  checkoutRoute,
  proWelcomeRoute,
  loginRoute,
  mockRoute,
  drillRoute,
  ...phase2Routes,
  shellRoute.addChildren([homeRoute, subjectRoute, chapterRoute, topicRoute, labsRoute, labRoute, practiceRoute, meRoute, settingsRoute, notificationsRoute, planRoute]),
]);

export function createAppRouter(context: RouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: "intent",
    defaultPendingComponent: RouteLoading,
    defaultPendingMs: 150,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
