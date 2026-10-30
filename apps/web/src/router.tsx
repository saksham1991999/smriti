/**
 * Routes (TanStack Router, code-based). Every screen is a lazy chunk; the shell and the boot code
 * are the only eager parts. Onboarding, the lesson player, the paywall and sign-in are full-screen;
 * everything else sits in the four-tab shell (R46: Learn, Labs, Practice, Me).
 */
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import type { Services } from "./boot/services";
import { withNamespaces } from "./lib/i18n";
import { useOnboarding } from "./lib/onboarding";
import { AppShell } from "./shell/AppShell";
import { RootLayout } from "./shell/RootLayout";
import { NotFound, RouteError, RouteLoading } from "./shell/States";
import { NotificationOpen, type NotificationSearch } from "./shell/NotificationOpen";

export interface RouterContext {
  services: Services;
  queryClient: QueryClient;
}

const onboarded = () =>
  useOnboarding.getState().completedAt !== null || useOnboarding.getState().firstWinAt !== null;

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
export const ONBOARDING_STEPS = [
  "goal",
  "class",
  "birth-year",
  "exam-date",
  "level",
  "buddy",
  "plant",
] as const;
export type OnboardingStepId = (typeof ONBOARDING_STEPS)[number];
const onboardingStepRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/$step",
  component: lazyRouteComponent(() => import("./screens/onboarding/Steps"), "OnboardingStep"),
});
const firstLessonRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/onboarding/first-lesson",
  component: lazyRouteComponent(
    withNamespaces(["memory_labs", "me_money"], () => import("./screens/lesson/LessonScreen")),
    "FirstLesson",
  ),
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
    mode:
      s.mode === "quick_revision"
        ? "quick_revision"
        : s.mode === "deep_dive"
          ? "deep_dive"
          : undefined,
    bite: typeof s.bite === "string" ? s.bite : undefined,
  }),
  component: lazyRouteComponent(
    withNamespaces(["memory_labs", "me_money"], () => import("./screens/lesson/LessonScreen")),
    "LessonScreen",
  ),
});
const lessonCompleteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/lesson-complete",
  component: lazyRouteComponent(
    withNamespaces(
      ["me_money", "memory_labs", "auth"],
      () => import("./screens/lesson/LessonComplete"),
    ),
    "LessonComplete",
  ),
});
const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/review",
  component: lazyRouteComponent(
    withNamespaces(["memory_labs"], () => import("./screens/memory/Review")),
    "Review",
  ),
});
export interface PaywallSearch {
  source?: string;
}
const paywallRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro",
  validateSearch: (s: Record<string, unknown>): PaywallSearch => ({
    source: typeof s.source === "string" ? s.source : undefined,
  }),
  component: lazyRouteComponent(
    withNamespaces(["me_money"], () => import("./screens/me/Paywall")),
    "Paywall",
  ),
});
const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro/checkout",
  component: lazyRouteComponent(
    withNamespaces(["me_money"], () => import("./screens/me/Paywall")),
    "Checkout",
  ),
});
const proWelcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/pro/welcome",
  component: lazyRouteComponent(
    withNamespaces(["me_money"], () => import("./screens/me/Paywall")),
    "ProWelcome",
  ),
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
    next:
      typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//")
        ? s.next
        : undefined,
  }),
  component: lazyRouteComponent(
    withNamespaces(["auth"], () => import("./screens/auth/Login")),
    "Login",
  ),
});
const guardianNs = ["auth", "me_money"] as const;
const guardian = (name: string) =>
  lazyRouteComponent(
    withNamespaces(guardianNs, () => import("./screens/auth/Guardian")),
    name as "ConsentAsk",
  );
export interface ConsentSearch {
  scope?: string;
  from?: string;
}
const consentAskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guardian/ask",
  validateSearch: (s: Record<string, unknown>): ConsentSearch => ({
    scope: typeof s.scope === "string" ? s.scope : undefined,
    from:
      typeof s.from === "string" && s.from.startsWith("/") && !s.from.startsWith("//")
        ? s.from
        : undefined,
  }),
  component: guardian("ConsentAsk"),
});
const consentHandoffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guardian/handoff",
  component: guardian("ConsentHandoff"),
});
const consentLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guardian/link",
  component: guardian("ConsentLink"),
});
const guardianLandingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/guardian/$code",
  component: guardian("GuardianLanding"),
});
const notificationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/notification",
  validateSearch: (s: Record<string, unknown>): NotificationSearch => ({
    to: typeof s.to === "string" ? s.to : undefined,
    id: typeof s.id === "string" ? s.id : undefined,
    t: typeof s.t === "string" ? s.t : undefined,
  }),
  component: NotificationOpen,
});
const parentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/parent",
  component: guardian("ParentMode"),
});
const mockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/mock/$mockId",
  component: lazyRouteComponent(
    withNamespaces(["practice"], () => import("./screens/practice/Mock")),
    "MockInstructionsRoute",
  ),
});
const attemptRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/attempt/$attemptId",
  component: lazyRouteComponent(
    withNamespaces(["practice"], () => import("./screens/practice/Mock")),
    "MockAttemptRoute",
  ),
});
const reportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/attempt/$attemptId/report",
  component: lazyRouteComponent(
    withNamespaces(["practice"], () => import("./screens/practice/Mock")),
    "MockReportRoute",
  ),
});
const solutionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/attempt/$attemptId/solutions",
  component: lazyRouteComponent(
    withNamespaces(["practice", "tutor_social"], () => import("./screens/practice/Mock")),
    "MockSolutionsRoute",
  ),
});
const drillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/drill/$topicId",
  component: lazyRouteComponent(
    withNamespaces(["practice", "tutor_social"], () => import("./screens/practice/Practice")),
    "Drill",
  ),
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
  component: lazyRouteComponent(
    withNamespaces(["memory_labs", "practice", "auth"], () => import("./screens/home/Home")),
    "Home",
  ),
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
  component: lazyRouteComponent(
    withNamespaces(["tutor_social"], () => import("./screens/learn/Learn")),
    "TopicScreen",
  ),
});
const labsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/labs",
  component: lazyRouteComponent(
    withNamespaces(["memory_labs"], () => import("./screens/labs/Labs")),
    "LabsHub",
  ),
});
const labRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/labs/$simId",
  component: lazyRouteComponent(
    withNamespaces(["memory_labs", "tutor_social"], () => import("./screens/labs/Labs")),
    "LabScreen",
  ),
});
const practiceRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/practice",
  component: lazyRouteComponent(
    withNamespaces(["practice"], () => import("./screens/practice/Practice")),
    "PracticeHub",
  ),
});
const challengeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/practice/challenge",
  component: lazyRouteComponent(
    withNamespaces(["practice", "tutor_social"], () => import("./screens/practice/Challenge")),
    "DailyChallengeScreen",
  ),
});
const pyqRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/practice/pyq",
  component: lazyRouteComponent(
    withNamespaces(["practice"], () => import("./screens/practice/Pyq")),
    "PyqBank",
  ),
});
const progressRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/practice/progress",
  component: lazyRouteComponent(
    withNamespaces(["practice"], () => import("./screens/practice/Progress")),
    "ProgressScreen",
  ),
});
const mocksRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/practice/mocks",
  component: lazyRouteComponent(
    withNamespaces(["practice"], () => import("./screens/practice/Mock")),
    "MockLobby",
  ),
});
const meRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me",
  component: lazyRouteComponent(
    withNamespaces(["me_money", "auth"], () => import("./screens/me/Me")),
    "Me",
  ),
});
const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me/settings",
  component: lazyRouteComponent(
    withNamespaces(["me_money", "auth"], () => import("./screens/me/Settings")),
    "Settings",
  ),
});
const notificationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me/notifications",
  component: lazyRouteComponent(
    withNamespaces(["me_money", "auth"], () => import("./screens/me/Settings")),
    "NotificationSettings",
  ),
});
const planRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/me/plan",
  component: lazyRouteComponent(
    withNamespaces(["me_money"], () => import("./screens/me/Paywall")),
    "YourPlan",
  ),
});

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
  consentAskRoute,
  consentHandoffRoute,
  consentLinkRoute,
  guardianLandingRoute,
  parentRoute,
  notificationRoute,
  mockRoute,
  attemptRoute,
  reportRoute,
  solutionsRoute,
  challengeRoute,
  drillRoute,
  shellRoute.addChildren([
    homeRoute,
    subjectRoute,
    chapterRoute,
    topicRoute,
    labsRoute,
    labRoute,
    practiceRoute,
    mocksRoute,
    pyqRoute,
    progressRoute,
    meRoute,
    settingsRoute,
    notificationsRoute,
    planRoute,
  ]),
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
