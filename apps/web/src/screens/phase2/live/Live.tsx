/**
 * Phase 3 live mocks on the web: MOCK-03 (the room: window, countdown, registration, reminder and
 * calendar, start) and MOCK-24 (the frozen leaderboard). The room comes from
 * `GET /v1/live/mocks/{id}`; its start, clock, closed and results events arrive over SSE
 * (`/events`), and every countdown runs on the server's clock. Registration is Pro.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readSse, unwrap } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { Banner, Button, Chip, EmptyState, Icon, Illustration, ProChip, cx, useUI } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { useI18n } from "../../../lib/i18n";
import { useOnline } from "../../../lib/network";
import { useIsPro } from "../../../lib/pro";
import { toast } from "../../../lib/toast";
import { LoadError, RouteLoading } from "../../../shell/States";
import { errorCode } from "../shared/errors";
import { useClose } from "../shared/nav";
import { Page, PageColumns } from "../shared/Page";
import { backoff, clockOffset, countdown, hm, hms, ics, lateMinutes, phase, splitBoard, titleIn, toLiveEvent, type LiveEvent, type Room } from "./logic";

const roomKey = (id: string) => ["live", id, "room"] as const;

function useFormat() {
  const { locale } = useI18n();
  const tag = locale === "hi" ? "hi-IN" : "en-IN";
  return useMemo(
    () => ({
      date: (iso: string) => new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)),
      time: (iso: string) => new Intl.DateTimeFormat(tag, { hour: "numeric", minute: "2-digit" }).format(new Date(iso)),
      when: (iso: string) => new Intl.DateTimeFormat(tag, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)),
    }),
    [tag],
  );
}

/** The room, plus the server-clock offset from its `server_time` and every SSE event since. */
function useRoom(mockId: string) {
  const s = useServices();
  const offset = useRef(0);
  const q = useQuery({
    queryKey: roomKey(mockId),
    queryFn: async () => {
      const room = await unwrap(s.client.GET("/v1/live/mocks/{mock_id}", { params: { path: { mock_id: mockId } } }), s.client);
      offset.current = clockOffset(room.server_time, Date.now());
      return room;
    },
    retry: (n, e) => errorCode(e) !== "not_found" && n < 2,
  });
  return { ...q, offset };
}

/** The live event stream, reconnecting with backoff while the room is mounted and not final. */
function useLiveEvents(mockId: string, enabled: boolean, onEvent: (e: LiveEvent) => void) {
  const s = useServices();
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    let attempt = 0;
    let timer: number | undefined;
    const run = async () => {
      try {
        const { response } = await s.client.GET("/v1/live/mocks/{mock_id}/events", { params: { path: { mock_id: mockId } }, parseAs: "stream", signal: ctrl.signal });
        if (!response.ok) throw new Error(`events ${response.status}`);
        attempt = 0;
        for await (const raw of readSse(response, ctrl.signal)) {
          const e = toLiveEvent(raw);
          if (e) handler.current(e);
        }
      } catch {
        // Dropped or refused: try again below.
      }
      if (ctrl.signal.aborted) return;
      attempt += 1;
      timer = window.setTimeout(() => void run(), backoff(attempt) * 1000);
    };
    void run();
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [mockId, enabled, s]);
}

function useNow(offset: { current: number }) {
  const [now, setNow] = useState(() => Date.now() + offset.current);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + offset.current), 1000);
    return () => window.clearInterval(id);
  }, [offset]);
  return now;
}

export function LiveRoom() {
  const { mockId } = useParams({ from: "/practice/live/$mockId" });
  const s = useServices();
  const { t, locale } = useI18n();
  const { altFor } = useUI();
  const f = useFormat();
  const navigate = useNavigate();
  const close = useClose("/practice");
  const online = useOnline();
  const isPro = useIsPro();
  const band = useAppStore((x) => x.profile?.age_band ?? null);
  const under13 = band === "u10" || band === "10_12";
  const queryClient = useQueryClient();
  const room = useRoom(mockId);
  const now = useNow(room.offset);
  const [busy, setBusy] = useState(false);
  const viewed = useRef(false);

  const final = room.data ? phase(room.data, now) === "results" : false;
  const onEvent = useCallback(
    (e: LiveEvent) => {
      room.offset.current = clockOffset(e.serverTime, Date.now());
      if (e.type !== "clock" && e.type !== "hello") void queryClient.invalidateQueries({ queryKey: roomKey(mockId) });
    },
    [queryClient, mockId, room.offset],
  );
  useLiveEvents(mockId, !!room.data && !final && online, onEvent);

  useEffect(() => {
    if (room.data && !viewed.current) {
      viewed.current = true;
      s.analytics.track("mock_detail_viewed", { mock_id: mockId, kind: "live", locked: isPro ? "no" : "pro" });
    }
  }, [room.data, s, mockId, isPro]);

  if (room.isPending) return <RouteLoading />;
  if (room.isError) {
    if (errorCode(room.error) === "not_found") {
      return (
        <Page title={t("practice:MOCK-03.live_chip")} onBack={close} testID="mock-03-missing">
          <EmptyState illustration="ui-search-empty" text={t("practice:MOCK-03.not_found")} action={{ label: t("practice:MOCK-03.back_practice"), onPress: () => void navigate({ to: "/practice" }) }} />
        </Page>
      );
    }
    return <LoadError onRetry={() => void room.refetch()} />;
  }
  const r: Room = room.data;
  const title = titleIn(r.title, locale);
  const p = phase(r, now);
  const cd = countdown(r, now);
  const late = p === "open" ? lateMinutes(r, now) : null;
  const durationMin = r.duration_s ? Math.round(r.duration_s / 60) : null;
  const reminderLead = Math.max(0, Math.round((Date.parse(r.window_start) - Date.parse(r.room_opens_at)) / 60_000));

  const register = async (on: boolean) => {
    setBusy(true);
    try {
      const res = on
        ? await unwrap(s.client.POST("/v1/live/mocks/{mock_id}/registration", { params: { path: { mock_id: mockId } } }), s.client)
        : await unwrap(s.client.DELETE("/v1/live/mocks/{mock_id}/registration", { params: { path: { mock_id: mockId } } }), s.client);
      if (res.registered) s.analytics.track("live_mock_registered", { mock_id: mockId });
      await queryClient.invalidateQueries({ queryKey: roomKey(mockId) });
    } catch (e) {
      const code = errorCode(e);
      if (code === "pro_required") void navigate({ to: "/pro", search: { source: "live_mock" } });
      else toast.show(code === "window_closed" ? t("practice:MOCK-03.closed", { results_at: r.results_at ? f.when(r.results_at) : "" }) : t("practice:MOCK-03.register_failed"));
    } finally {
      setBusy(false);
    }
  };
  const calendar = () => {
    const file = ics({ id: mockId, title, start: r.window_start, end: r.window_end, now: Date.now(), url: typeof location !== "undefined" ? location.href : undefined });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([file], { type: "text/calendar" }));
    a.download = `${mockId}.ics`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const results = r.results_at ? f.when(r.results_at) : null;

  const action = (() => {
    if (p === "results") return <Button label={t("practice:MOCK-03.see_leaderboard")} icon="TrendUp" onPress={() => void navigate({ to: "/practice/live/$mockId/leaderboard", params: { mockId } })} testID="mock-03-leaderboard" />;
    if (p === "closed" || p === "taken") return null;
    if (!isPro) return under13 ? <ProChip askGrownUp /> : <Button label={t("practice:MOCK-03.unlock")} icon="LockSimple" onPress={() => void navigate({ to: "/pro", search: { source: "live_mock" } })} testID="mock-03-unlock" />;
    if (p === "open" && r.can_start) return <Button label={t("practice:MOCK-03.start_now")} icon="Play" disabled={!online} onPress={() => void navigate({ to: "/practice/mock/$mockId", params: { mockId } })} testID="mock-03-start" />;
    if (r.registered) return <Button label={t("practice:MOCK-03.registered")} icon="CheckCircle" disabled testID="mock-03-registered" />;
    return <Button label={t("practice:MOCK-03.register")} loading={busy} disabled={!online} onPress={() => void register(true)} testID="mock-03-register" />;
  })();

  const windowCard = (
    <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" aria-labelledby="mock-03-window" data-testid="mock-03-window">
      <h2 id="mock-03-window" className="m-0 text-heading">
        {f.date(r.window_start)}
      </h2>
      <p className="m-0 text-body text-ink tabular-nums">{t("practice:MOCK-03.window.2", { start_time: f.time(r.window_start), end_time: f.time(r.window_end) })}</p>
      {cd.kind !== "none" && p !== "taken" && (
        <p className="m-0 flex items-center gap-2 text-title font-bold text-ink tabular-nums" data-testid="mock-03-countdown" title={t("practice:MOCK-03.time_to_start")}>
          <Icon name="Timer" size={24} className="text-primary-text" />
          {cd.kind === "starts" ? t("practice:MOCK-03.starts_in", { time: hms(cd.ms) }) : t("practice:MOCK-03.closes_in", { time: hm(cd.ms) })}
        </p>
      )}
      <p className="m-0 flex items-center gap-2 text-label text-ink-muted" data-testid="mock-03-registrations">
        <Icon name="UsersThree" size={20} />
        {t("practice:MOCK-03.registrations", { n: r.registrations })}
      </p>
    </section>
  );
  const how = (
    <section className="flex flex-col gap-2 rounded-card bg-surface p-4 shadow-card" aria-labelledby="mock-03-how">
      <h2 id="mock-03-how" className="m-0 text-heading">
        {t("practice:MOCK-03.how_title")}
      </h2>
      <ol className="m-0 flex list-decimal flex-col gap-2 ps-6 text-body text-ink marker:font-bold marker:text-primary-text">
        <li>{t("practice:MOCK-03.how_it_works_1")}</li>
        {r.full_duration_until && durationMin && <li>{t("practice:MOCK-03.how_it_works_2", { latest_full_start: f.time(r.full_duration_until), duration_min: durationMin })}</li>}
        {results && <li>{t("practice:MOCK-03.how_it_works_3", { results_at: results })}</li>}
      </ol>
    </section>
  );
  const reminder =
    r.registered && p === "scheduled" ? (
      <section className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card" data-testid="mock-03-reminder">
        <p className="m-0 flex items-center gap-2 text-body text-ink">
          <Icon name="Bell" size={20} className="text-primary-text" />
          {t("practice:MOCK-03.reminder_set", { reminder_lead: t("practice:MOCK-03.minutes", { n: reminderLead }) })}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button label={t("practice:MOCK-03.calendar")} variant="secondary" size="sm" icon="CalendarCheck" onPress={calendar} testID="mock-03-calendar" />
          <Button label={t("practice:MOCK-03.unregister")} variant="ghost" size="sm" loading={busy} onPress={() => void register(false)} testID="mock-03-unregister" />
        </div>
      </section>
    ) : null;

  return (
    <Page
      title={title}
      onBack={close}
      width="lg"
      trailing={<Chip kind="status" tone="error" icon="Broadcast" label={t("practice:MOCK-03.live_chip")} />}
      testID="mock-03"
      footer={action ?? undefined}
    >
      <h1 className="sr-only">{title}</h1>
      <div className="overflow-hidden rounded-card-large bg-primary-tint">
        <Illustration name="scene-exam-goal" alt={altFor("scene-exam-goal")} fit="cover" className="aspect-[3/1] w-full min-[600px]:aspect-[5/1]" />
      </div>
      {!online && <Banner tone="offline" icon="WifiSlash" text={t("practice:MOCK-03.needs_internet")} testID="mock-03-offline" />}
      {p === "closed" && <Banner tone="info" text={t("practice:MOCK-03.closed", { results_at: results ?? "" })} testID="mock-03-closed" />}
      {p === "taken" && <Banner tone="info" icon="CheckCircle" text={t("practice:MOCK-03.taken", { results_at: results ?? "" })} testID="mock-03-taken" />}
      {late !== null && <Banner tone="warning" icon="Timer" text={t("practice:MOCK-03.late_start", { remaining: late, end_time: f.time(r.window_end) })} testID="mock-03-late" />}
      <PageColumns
        left={
          <>
            {windowCard}
            {reminder}
          </>
        }
        right={how}
      />
    </Page>
  );
}

export function LiveLeaderboard() {
  const { mockId } = useParams({ from: "/practice/live/$mockId/leaderboard" });
  const s = useServices();
  const { t, locale } = useI18n();
  const f = useFormat();
  const close = useClose(`/practice/live/${mockId}`);
  const room = useRoom(mockId);
  const board = useQuery({ queryKey: ["live", mockId, "board"], queryFn: () => unwrap(s.client.GET("/v1/live/mocks/{mock_id}/leaderboard", { params: { path: { mock_id: mockId }, query: { limit: 100 } } }), s.client) });
  useEffect(() => {
    if (board.data) s.analytics.track("mock_leaderboard_viewed", { mock_id: mockId, scope: "all_india" });
  }, [board.data, s, mockId]);

  if (board.isPending || room.isPending) return <RouteLoading />;
  if (board.isError) return <LoadError onRetry={() => void board.refetch()} />;
  const b = board.data;
  const title = room.data ? titleIn(room.data.title, locale) : "";
  const results = room.data?.results_at ? f.when(room.data.results_at) : "";
  const { top, rest } = splitBoard(b.rows);
  const you = b.you;
  const nameOf = (row: { is_you: boolean; name: string | null }) => (row.is_you ? t("practice:MOCK-24.you") : (row.name ?? ""));
  return (
    <Page
      title={t("practice:MOCK-24.title", { mock_title: title })}
      onBack={close}
      width="lg"
      testID="mock-24"
      footer={
        you ? (
          <p className="m-0 flex min-h-14 items-center gap-3 rounded-card bg-primary-tint px-4 text-label font-bold text-ink tabular-nums" aria-label={t("practice:MOCK-24.your_rank_a11y", { rank: you.rank, score: you.score, percentile: you.percentile ?? "–" })} data-testid="mock-24-you">
            <Icon name="UserCircle" size={24} className="text-primary-text" />
            {t("practice:MOCK-24.own_row", { rank: you.rank, score: you.score, percentile: you.percentile ?? "–" })}
          </p>
        ) : undefined
      }
    >
      <h1 className="sr-only">{t("practice:MOCK-24.title", { mock_title: title })}</h1>
      <p className="m-0 text-caption text-ink-muted">{b.published ? t("practice:MOCK-24.meta", { ranked_count: b.ranked, results_at: results }) : null}</p>
      {!b.published ? (
        <EmptyState illustration="scene-exam-goal" text={b.reason === "below_threshold" ? t("practice:MOCK-24.too_few") : t("practice:MOCK-24.pending", { results_at: results })} testID="mock-24-pending" />
      ) : (
        <>
          <ol className="m-0 grid list-none gap-3 p-0 min-[600px]:grid-cols-3" aria-label={t("practice:MOCK-24.top_three")} data-testid="mock-24-top">
            {top.map((row) => (
              <li key={row.rank} className={cx("flex items-center gap-3 rounded-card bg-surface p-4 shadow-card min-[600px]:flex-col min-[600px]:text-center", row.is_you && "ring-2 ring-primary")} aria-label={t("practice:MOCK-24.row_a11y", { rank: row.rank, name: nameOf(row), score: row.score, percentile: row.percentile ?? "–" })}>
                <span className="text-title font-bold text-primary-text tabular-nums" aria-hidden="true">
                  {row.rank}
                </span>
                <Avatar avatar={row.avatar} />
                <span className="flex min-w-0 flex-col" aria-hidden="true">
                  <span className="truncate text-body font-bold text-ink">{nameOf(row)}</span>
                  <span className="text-caption text-ink-muted tabular-nums">
                    {row.score} · {t("practice:MOCK-24.percentile", { percentile: row.percentile ?? "–" })}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {rest.length > 0 && (
            <table className="w-full border-collapse text-body" data-testid="mock-24-table">
              <thead>
                <tr className="text-caption text-ink-muted">
                  <th scope="col" className="w-12 py-2 text-start font-bold">{t("practice:MOCK-24.col_rank")}</th>
                  <th scope="col" className="py-2 text-start font-bold">{t("practice:MOCK-24.col_name")}</th>
                  <th scope="col" className="py-2 text-end font-bold">{t("practice:MOCK-24.col_score")}</th>
                  <th scope="col" className="py-2 text-end font-bold">{t("practice:MOCK-24.col_percentile")}</th>
                </tr>
              </thead>
              <tbody>
                {rest.map((row) => (
                  <tr key={row.rank} className={cx("border-t border-hairline", row.is_you && "bg-primary-tint")}>
                    <td className="py-2 tabular-nums">{row.rank}</td>
                    <th scope="row" className="py-2 text-start font-normal">
                      <span className="flex items-center gap-2">
                        <Avatar avatar={row.avatar} size={28} />
                        <span className="truncate">{nameOf(row)}</span>
                      </span>
                    </th>
                    <td className="py-2 text-end tabular-nums">{row.score}</td>
                    <td className="py-2 text-end tabular-nums">{row.percentile ?? "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="m-0 text-caption text-ink-muted">{t("practice:MOCK-24.footer")}</p>
        </>
      )}
    </Page>
  );
}

/** A pet avatar (the server sends the species for minors and for anyone without a photo). */
function Avatar({ avatar, size = 40 }: { avatar: string | null; size?: number }) {
  const species = avatar === "cat" || avatar === "dog" ? avatar : null;
  return species ? <Illustration name={`${species}-base`} decorative width={size} height={size} className="shrink-0 rounded-full bg-primary-tint" /> : <Icon name="UserCircle" size={size >= 32 ? 32 : 24} className="shrink-0 text-ink-muted" />;
}
