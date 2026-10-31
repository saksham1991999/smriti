/**
 * AI-02 tutor chat (a sheet on phones, a right-hand panel from 600 px), with AI-06 (daily limit)
 * and AI-08 (refusal, redirect and the crisis card) inline. Everything comes from `/v1/tutor`:
 * the answer streams in, the limit is counted on the server, and the crisis helplines are the
 * server's config (`safety.helplines`), never a number in this code.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import type { MessageKey } from "@smriti/i18n";
import { PlayerProvider, RichText, contentUrl } from "@smriti/lesson-player-web";
import {
  Banner,
  Button,
  Card,
  Chip,
  ChatBubble,
  ChatInput,
  Icon,
  IconButton,
  PetAvatar,
  PetLine,
  Sheet,
  Text,
} from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { useI18n } from "../../lib/i18n";
import { stubBundle } from "../../lib/mocks";
import { useOnline } from "../../lib/network";
import { useIntroEligible, useIsPro } from "../../lib/pro";
import { useProfileIds } from "../../lib/queries";
import { GrownUpCheck } from "../../components/GrownUpCheck";
import { toast } from "../../lib/toast";
import {
  openSession,
  sendFeedback,
  sendMessage,
  useTutorUI,
  type Helpline,
  type TutorContext,
  type TutorEvent,
  type TutorQuota,
} from "../../lib/tutor";

type Species = "cat" | "dog";

interface Msg {
  key: string;
  clientId?: string;
  id?: string;
  role: "student" | "tutor";
  text: string;
  streaming?: boolean;
  status?: "ok" | "stopped" | "refused" | "crisis" | "error" | "quota_exhausted";
  error?: string;
  chips?: string[];
  citations?: { kind: string; id: string; title?: string | null }[];
  safety?:
    | { kind: "refusal" | "redirect" | "pii_removed" }
    | { kind: "crisis"; helplines: Helpline[] };
  exhausted?: { tier: "free" | "pro_fair_use"; trigger: string | null };
  rated?: "up" | "down";
  /** The student text to resend on [Try again]. */
  resend?: { text: string; input: "typed" | "chip" | "prefill"; chip?: string | null };
}

const CHIP_KEYS: Record<string, MessageKey> = {
  explain_simpler: "tutor_social:AI-02.follow_up_chips.1",
  show_example: "tutor_social:AI-02.follow_up_chips.2",
  quiz_me: "tutor_social:AI-02.follow_up_chips.3",
  make_story: "tutor_social:AI-02.follow_up_chips.4",
  draw_it: "tutor_social:AI-02.follow_up_chips.5",
  show_full_solution: "tutor_social:AI-02.follow_up_chips.6",
  give_hint: "tutor_social:AI-02.starter_chips.2",
};

function useWide(): boolean {
  const q = "(min-width: 600px)";
  const [wide, setWide] = useState(
    () => typeof window !== "undefined" && window.matchMedia(q).matches,
  );
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The panel host: a sheet under 600 px, a 400 px side panel above. Mounted by the shell when open. */
export function TutorPanel() {
  const { t } = useI18n();
  const open = useTutorUI((x) => x.open);
  const close = useTutorUI((x) => x.close);
  const wide = useWide();
  const pet = useAppStore((x) => x.pet);
  const petName = pet?.name ?? "";
  const title = t("tutor_social:AI-01.accessibility_label", { pet_name: petName });

  useEffect(() => {
    if (!open || !wide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, wide, close]);

  if (!wide) {
    return (
      <Sheet
        open={open}
        onOpenChange={(o) => !o && close()}
        title={title}
        hideTitle
        height="full"
        testID="ai-02"
      >
        <TutorChat />
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <aside
      aria-label={title}
      data-testid="ai-02"
      className="fixed inset-y-0 right-0 z-40 flex w-[400px] max-w-full flex-col border-s border-line bg-surface shadow-raised"
    >
      <TutorChat />
    </aside>
  );
}

function TutorChat() {
  const { t, locale } = useI18n();
  const s = useServices();
  const navigate = useNavigate();
  const online = useOnline();
  const pro = useIsPro();
  const eligible = useIntroEligible();
  const exam = useProfileIds()[0] ?? null;
  const pet = useAppStore((x) => x.pet);
  const petName = pet?.name ?? "";
  const species: Species = pet?.species === "dog" ? "dog" : "cat";
  const { context: initialContext, prefill, close } = useTutorUI();
  const [context, setContext] = useState<TutorContext | null>(initialContext);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [quota, setQuota] = useState<TutorQuota | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState(prefill);
  const [loadFailed, setLoadFailed] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const listEnd = useRef<HTMLDivElement>(null);
  const crisisRef = useRef<HTMLDivElement>(null);
  const streaming = msgs.some((m) => m.streaming);
  const bundle = useMemo(() => stubBundle(locale, []), [locale]);

  const start = useCallback(
    async (ctx: TutorContext | null) => {
      setLoadFailed(false);
      try {
        const sess = await openSession(s, ctx, exam);
        setSessionId(sess.id);
        setQuota(sess.quota);
        setExhausted(!sess.quota.unlimited && sess.quota.remaining === 0);
        setMsgs(
          (sess.messages ?? []).map((m) => ({
            key: m.id,
            id: m.id,
            role: m.role === "user" ? "student" : "tutor",
            text: m.content,
            status: m.status,
            citations: m.citations as Msg["citations"],
          })),
        );
      } catch (err) {
        s.logger.warn("tutor.open_failed", { code: (err as { code?: string }).code ?? "network" });
        setLoadFailed(true);
      }
    },
    [exam, s],
  );

  useEffect(() => {
    void start(context);
    return () => abort.current?.abort();
    // A new context starts (or reopens) its own chat.
  }, [context, start]);

  useEffect(() => {
    listEnd.current?.scrollIntoView({ block: "end" });
  }, [msgs]);

  const patch = (key: string, f: (m: Msg) => Msg) =>
    setMsgs((xs) => xs.map((m) => (m.key === key ? f(m) : m)));

  const send = async (
    text: string,
    input: "typed" | "chip" | "prefill",
    chip: string | null = null,
    clientId = s.newId(),
    retryKey?: string,
  ) => {
    if (!sessionId || !text.trim()) return;
    const tutorKey = retryKey ?? `${clientId}:a`;
    if (retryKey)
      patch(retryKey, (m) => ({
        ...m,
        text: "",
        status: undefined,
        error: undefined,
        streaming: true,
      }));
    else {
      setMsgs((xs) => [
        ...xs.map((m) => ({ ...m, chips: undefined })),
        { key: clientId, clientId, role: "student", text },
        { key: tutorKey, role: "tutor", text: "", streaming: true, resend: { text, input, chip } },
      ]);
      setDraft("");
    }
    const ctl = new AbortController();
    abort.current = ctl;
    const onEvent = (e: TutorEvent) => {
      switch (e.type) {
        case "delta":
          patch(tutorKey, (m) => ({ ...m, text: m.text + e.text }));
          break;
        case "replace":
          patch(tutorKey, (m) => ({ ...m, text: e.text }));
          break;
        case "error":
          patch(tutorKey, (m) => ({ ...m, status: "error", error: e.code }));
          break;
        case "citations":
          patch(tutorKey, (m) => ({ ...m, citations: e.items }));
          break;
        case "chips":
          patch(tutorKey, (m) => ({ ...m, chips: e.items }));
          break;
        case "quota":
          setQuota(e.quota);
          break;
        case "quota_exhausted":
          setQuota(e.quota);
          setExhausted(true);
          patch(tutorKey, (m) => ({
            ...m,
            status: "quota_exhausted",
            exhausted: { tier: e.tier, trigger: e.paywall_trigger },
          }));
          break;
        case "safety":
          if (e.kind === "crisis")
            patch(tutorKey, (m) => ({
              ...m,
              status: "crisis",
              safety: { kind: "crisis", helplines: e.helplines ?? [] },
            }));
          else if (e.kind === "refusal")
            patch(tutorKey, (m) => ({
              ...m,
              status: "refused",
              safety: { kind: "refusal" },
              chips: e.chips,
            }));
          else patch(tutorKey, (m) => ({ ...m, safety: { kind: e.kind } }));
          break;
        case "done":
          patch(tutorKey, (m) => ({
            ...m,
            id: e.message_id ?? m.id,
            streaming: false,
            status: m.status ?? (e.status as Msg["status"]) ?? "ok",
          }));
          break;
        default:
          break;
      }
    };
    try {
      await sendMessage(
        s,
        sessionId,
        { client_message_id: clientId, text, input, chip_id: chip },
        onEvent,
        ctl.signal,
      );
      patch(tutorKey, (m) => ({ ...m, streaming: false }));
    } catch (err) {
      if (ctl.signal.aborted)
        patch(tutorKey, (m) => ({ ...m, streaming: false, status: "stopped" }));
      else {
        s.logger.warn("tutor.send_failed", { code: (err as { code?: string }).code ?? "network" });
        patch(tutorKey, (m) => ({
          ...m,
          streaming: false,
          status: "error",
          error: (err as { code?: string }).code ?? "network",
        }));
      }
    }
    // Retries reuse the student's message id, so the server replays instead of counting twice.
    patch(tutorKey, (m) => ({ ...m, resend: m.resend ? { ...m.resend } : m.resend, clientId }));
  };

  const retry = (m: Msg) => {
    if (!m.resend || !m.clientId) return;
    void send(m.resend.text, m.resend.input, m.resend.chip ?? null, m.clientId, m.key);
  };

  const crisisShown = msgs.some((m) => m.safety?.kind === "crisis");
  useEffect(() => {
    if (crisisShown) crisisRef.current?.focus();
  }, [crisisShown]);

  const chipLabel = (id: string): string | null => {
    if (id === "back_to_topic")
      return context ? t("tutor_social:AI-08.chip", { topic_title: context.title }) : null;
    const key = CHIP_KEYS[id];
    return key ? t(key) : null;
  };
  const tapChip = (id: string, label: string) => {
    if (id === "draw_it" && !pro) {
      void navigate({ to: "/pro", search: { source: "tutor_image" } });
      return;
    }
    void send(label, "chip", id);
  };

  const starters: [string, string][] = !context
    ? [
        ["explain_topic", t("tutor_social:AI-02.starter_chips_no_context.1")],
        ["help_question", t("tutor_social:AI-02.starter_chips_no_context.2")],
        ["quiz_me", t("tutor_social:AI-02.starter_chips_no_context.3")],
      ]
    : context.kind === "question"
      ? [
          ["why_wrong", t("tutor_social:AI-02.starter_chips_question.1")],
          ["explain_solution", t("tutor_social:AI-02.starter_chips_question.2")],
          ["similar_one", t("tutor_social:AI-02.starter_chips_question.3")],
        ]
      : [
          ["explain_simpler", t("tutor_social:AI-02.starter_chips.1")],
          ["give_hint", t("tutor_social:AI-02.starter_chips.2")],
          ["show_example", t("tutor_social:AI-02.starter_chips.3")],
        ];

  const resetAt = quota?.resets_at
    ? new Date(quota.resets_at).toLocaleTimeString(locale === "hi" ? "hi-IN" : "en-IN", {
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
  const showCounter = quota && !quota.unlimited && quota.limit !== null && msgs.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col" lang={locale}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-2">
        <PetAvatar species={species} size={40} />
        <span className="flex min-w-0 flex-1 flex-col">
          <Text variant="heading" className="truncate">
            {petName}
          </Text>
          {showCounter && (
            <Text variant="caption" tone="muted" testID="tutor-counter">
              {t("tutor_social:AI-02.free_counter", {
                n: quota.remaining ?? 0,
                limit: quota.limit ?? 0,
              })}
            </Text>
          )}
        </span>
        <IconButton
          icon="Plus"
          label={t("tutor_social:AI-02.menu_new_chat")}
          onPress={() => setContext(null)}
          testID="tutor-new"
        />
        <IconButton icon="X" label={t("ui:common.close")} onPress={close} testID="tutor-close" />
      </header>
      {context && (
        <div className="flex px-4 pt-2">
          <Chip
            kind="filter"
            icon="BookBookmark"
            label={
              context.kind === "question"
                ? context.title
                : t("tutor_social:AI-02.context_chip", { context_title: context.title })
            }
            onPress={() => setContext(null)}
            accessibilityLabel={`${t("tutor_social:AI-02.context_chip", { context_title: context.title })}, ${t("tutor_social:AI-02.menu_new_chat")}`}
            testID="tutor-context"
          />
        </div>
      )}
      {!online && (
        <div className="px-4 pt-2">
          <Banner tone="offline" text={t("tutor_social:AI-02.offline_pet_line")} />
        </div>
      )}
      <PlayerProvider
        value={{ t, bundle, contentBaseUrl: contentUrl(s.contentBaseUrl, ""), online }}
      >
        <div
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3"
          data-testid="tutor-messages"
        >
          {loadFailed ? (
            <Card tone="sunken">
              <span className="flex flex-col gap-2">
                <Text>{t("tutor_social:AI-02.server_error")}</Text>
                <Button
                  variant="secondary"
                  size="sm"
                  label={t("tutor_social:AI-02.try_again")}
                  onPress={() => void start(context)}
                />
              </span>
            </Card>
          ) : msgs.length === 0 ? (
            <div className="flex flex-col gap-3">
              <PetLine
                pet={{ species, mood: "happy" }}
                petName={petName}
                text={t("tutor_social:AI-02.greeting_pet_line_empty_chat")}
              />
              <div className="flex flex-wrap gap-2">
                {starters.map(([id, label]) => (
                  <Chip
                    key={id}
                    kind="filter"
                    label={label}
                    onPress={() => void send(label, "chip", id)}
                    testID={`tutor-starter-${id}`}
                  />
                ))}
              </div>
            </div>
          ) : (
            msgs.map((m) =>
              m.role === "student" ? (
                <ChatBubble key={m.key} role="student" text={m.text} testID="tutor-student" />
              ) : (
                <TutorMessage
                  key={m.key}
                  m={m}
                  petName={petName}
                  species={species}
                  context={context}
                  chipLabel={chipLabel}
                  onChip={tapChip}
                  onRetry={() => retry(m)}
                  crisisRef={crisisRef}
                  onRate={(rating) => {
                    if (!m.id) return;
                    patch(m.key, (x) => ({ ...x, rated: rating }));
                    void sendFeedback(s, m.id, rating).then(
                      (ok) =>
                        ok &&
                        toast.show(
                          rating === "up"
                            ? t("tutor_social:AI-05.thumbs_up_toast")
                            : t("tutor_social:AI-05.thanks_toast", { pet_name: petName }),
                        ),
                    );
                  }}
                  exhaustedCard={
                    m.exhausted ? (
                      <LimitCard
                        tier={m.exhausted.tier}
                        trigger={m.exhausted.trigger}
                        limit={quota?.limit ?? null}
                        resetAt={resetAt}
                        eligible={eligible}
                        online={online}
                        onPro={() =>
                          void navigate({ to: "/pro", search: { source: "tutor_limit" } })
                        }
                        onReview={() => void navigate({ to: "/review" })}
                        onParent={() => void navigate({ to: "/parent" })}
                      />
                    ) : null
                  }
                />
              ),
            )
          )}
          <div ref={listEnd} />
        </div>
      </PlayerProvider>
      <ChatInput
        value={draft}
        onChange={setDraft}
        onSend={() => void send(draft, prefill && draft === prefill ? "prefill" : "typed")}
        label={
          context
            ? t("tutor_social:AI-02.input_placeholder_with_context")
            : t("tutor_social:AI-02.input_placeholder_no_context")
        }
        placeholder={
          exhausted && resetAt
            ? t("tutor_social:AI-06.reset", { reset_time: resetAt })
            : context
              ? t("tutor_social:AI-02.input_placeholder_with_context")
              : t("tutor_social:AI-02.input_placeholder_no_context")
        }
        maxLength={1000}
        disabled={!online || !sessionId || exhausted}
        streaming={streaming}
        onStop={() => abort.current?.abort()}
        testID="tutor-input"
      />
    </div>
  );
}

function TutorMessage(props: {
  m: Msg;
  petName: string;
  species: Species;
  context: TutorContext | null;
  chipLabel: (id: string) => string | null;
  onChip: (id: string, label: string) => void;
  onRetry: () => void;
  onRate: (r: "up" | "down") => void;
  crisisRef: React.RefObject<HTMLDivElement | null>;
  exhaustedCard: ReactNode;
}) {
  const { t } = useI18n();
  const { m, petName, species } = props;
  if (m.safety?.kind === "crisis")
    return (
      <CrisisCard
        helplines={m.safety.helplines}
        petName={petName}
        species={species}
        innerRef={props.crisisRef}
      />
    );
  if (m.exhausted) return <>{props.exhaustedCard}</>;
  const chips = (m.chips ?? [])
    .map((id) => [id, props.chipLabel(id)] as const)
    .filter((x): x is readonly [string, string] => !!x[1]);
  const safetyLine =
    m.safety?.kind === "refusal"
      ? t("tutor_social:AI-08.refusal")
      : m.safety?.kind === "redirect" && props.context
        ? t("tutor_social:AI-08.redirect_under_13", { topic_title: props.context.title })
        : null;
  return (
    <div
      className="flex flex-col gap-2"
      data-testid="tutor-answer"
      data-status={m.status ?? (m.streaming ? "streaming" : "")}
    >
      {m.safety?.kind === "pii_removed" && (
        <Text variant="caption" tone="muted">
          {t("tutor_social:AI-08.personal_info_reminder")}
        </Text>
      )}
      {safetyLine ? (
        <PetLine pet={{ species, mood: "thinking" }} petName={petName} text={safetyLine} />
      ) : m.status === "error" ? (
        <Card tone="sunken">
          <span className="flex flex-col gap-2">
            <Text>{t("tutor_social:AI-02.server_error")}</Text>
            <Button
              variant="secondary"
              size="sm"
              label={t("tutor_social:AI-02.try_again")}
              onPress={props.onRetry}
              testID="tutor-retry"
            />
          </span>
        </Card>
      ) : (
        <ChatBubble
          role="tutor"
          authorName={petName}
          avatar={{ species }}
          streaming={m.streaming}
          stopped={m.status === "stopped"}
          citations={
            m.citations && m.citations.length > 0 ? (
              <>
                {m.citations.slice(0, 3).map((c) => (
                  <Chip
                    key={`${c.kind}:${c.id}`}
                    kind="status"
                    tone="sunken"
                    label={c.title ?? ""}
                  />
                ))}
              </>
            ) : undefined
          }
          actions={
            m.id && m.status === "ok" ? (
              <>
                {/* ui-web has no ThumbsUp, ThumbsDown, Copy or Phone icons yet (reported); the nearest Phosphor icons stand in. */}
                <IconButton
                  icon="Smiley"
                  label={t("tutor_social:AI-05.thumbs_up_toast")}
                  onPress={() => props.onRate("up")}
                  variant={m.rated === "up" ? "filled" : "plain"}
                  disabled={!!m.rated}
                  testID="tutor-up"
                />
                <IconButton
                  icon="Flag"
                  label={t("tutor_social:AI-02.report")}
                  onPress={() => props.onRate("down")}
                  variant={m.rated === "down" ? "filled" : "plain"}
                  disabled={!!m.rated}
                  testID="tutor-down"
                />
                <IconButton
                  icon="FileText"
                  label={t("tutor_social:AI-02.copy")}
                  onPress={() => {
                    void navigator.clipboard
                      ?.writeText(m.text)
                      .then(() => toast.show(t("tutor_social:AI-02.copied")));
                  }}
                />
              </>
            ) : undefined
          }
          testID="tutor-bubble"
        >
          {m.text ? <RichText text={m.text} /> : undefined}
        </ChatBubble>
      )}
      {chips.length > 0 && !m.streaming && (
        <div className="flex flex-wrap gap-2">
          {chips.map(([id, label]) => (
            <Chip
              key={id}
              kind="filter"
              label={label}
              icon={id === "draw_it" ? "Lock" : undefined}
              onPress={() => props.onChip(id, label)}
              testID={`tutor-chip-${id}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** AI-06: free questions used up. Under-13s (no paywall trigger) never see a price (R15). */
function LimitCard(p: {
  tier: "free" | "pro_fair_use";
  trigger: string | null;
  limit: number | null;
  resetAt: string;
  eligible: boolean;
  online: boolean;
  onPro: () => void;
  onReview: () => void;
  onParent: () => void;
}) {
  const { t } = useI18n();
  const [ask, setAsk] = useState(false);
  const fairUse = p.tier === "pro_fair_use";
  const child = !fairUse && p.trigger === null;
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-card bg-streak-tint p-4"
      data-testid="ai-06"
    >
      <Text variant="heading">
        {fairUse
          ? t("tutor_social:AI-06.pro_fair_use_variant_title")
          : t("tutor_social:AI-06.title", { limit: p.limit ?? 0 })}
      </Text>
      <Text>
        {fairUse
          ? t("tutor_social:AI-06.pro_fair_use_variant_body")
          : child
            ? t("tutor_social:AI-06.under_13_body")
            : t("tutor_social:AI-06.body")}
      </Text>
      {p.resetAt && !fairUse && (
        <span className="flex items-center gap-2">
          <Icon name="Clock" size={16} color="inkMuted" />
          <Text variant="caption">{t("tutor_social:AI-06.reset", { reset_time: p.resetAt })}</Text>
        </span>
      )}
      {fairUse || child ? (
        <>
          <Button
            variant="secondary"
            label={t("tutor_social:AI-06.under_13_buttons.1")}
            onPress={p.onReview}
            testID="ai-06-review"
          />
          {child && (
            <Button
              variant="ghost"
              label={t("tutor_social:AI-06.under_13_buttons.2")}
              onPress={() => setAsk(true)}
              testID="ai-06-grown-up"
            />
          )}
          {/* PAY-03 without a price (R15): "yes" opens Parent mode for the grown-up. */}
          <GrownUpCheck
            open={ask}
            child
            eligible={false}
            onYes={p.onParent}
            onClose={() => setAsk(false)}
          />
        </>
      ) : (
        <>
          <Button
            label={
              p.eligible
                ? t("tutor_social:AI-06.primary")
                : t("me_money:ME-01.pro_card_not_eligible")
            }
            onPress={p.onPro}
            disabled={!p.online}
            testID="ai-06-pro"
          />
          <Text variant="caption" tone="muted">
            {t("tutor_social:AI-06.pet_line")}
          </Text>
        </>
      )}
    </div>
  );
}

/** AI-08 crisis card. Helplines are the server's `safety.helplines` for this locale; none are invented here. */
function CrisisCard({
  helplines,
  petName,
  species,
  innerRef,
}: {
  helplines: Helpline[];
  petName: string;
  species: Species;
  innerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const [trusted, setTrusted] = useState(false);
  return (
    <div
      ref={innerRef}
      tabIndex={-1}
      role="alert"
      aria-labelledby="crisis-title"
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 dark:bg-surface-raised"
      data-testid="ai-08-crisis"
    >
      <PetAvatar species={species} mood="resting" size={40} />
      <Text variant="heading" id="crisis-title">
        {t("tutor_social:AI-08.crisis_title")}
      </Text>
      <Text>{t("tutor_social:AI-08.crisis_body")}</Text>
      {helplines.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0" data-testid="crisis-helplines">
          {helplines.map((h) => {
            const extra = Object.entries(h)
              .filter(
                ([k, v]) =>
                  k !== "name" && k !== "number" && typeof v === "string" && !/^https?:/.test(v),
              )
              .map(([, v]) => v);
            return (
              <li key={`${h.name}:${h.number}`} className="flex flex-wrap items-center gap-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <Text variant="label">{h.name}</Text>
                  {extra[0] && (
                    <Text variant="caption" tone="muted">
                      {extra[0]}
                    </Text>
                  )}
                  <Text variant="heading" className="tabular-nums">
                    {h.number}
                  </Text>
                </span>
                <a
                  href={`tel:${h.number.replace(/[^\d+]/g, "")}`}
                  className="inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-4 text-label font-bold text-on-primary"
                  aria-label={`${t("tutor_social:AI-08.call_button", { helpline_name: h.name })}, ${h.number}`}
                >
                  {t("tutor_social:AI-08.call_button", { helpline_name: h.name })}
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        variant="secondary"
        label={t("tutor_social:AI-08.trusted_person")}
        onPress={() => setTrusted((v) => !v)}
        testID="crisis-trusted"
      />
      {trusted && (
        <ul className="m-0 flex flex-col gap-1 ps-5">
          <li>
            <Text>{t("tutor_social:AI-08.trusted_list.1")}</Text>
          </li>
          <li>
            <Text>{t("tutor_social:AI-08.trusted_list.2")}</Text>
          </li>
          <li>
            <Text>{t("tutor_social:AI-08.trusted_list.3")}</Text>
          </li>
        </ul>
      )}
      <Button
        variant="ghost"
        label={t("tutor_social:AI-08.keep_talking", { pet_name: petName })}
        onPress={() => innerRef.current?.blur()}
        testID="crisis-keep-talking"
      />
    </div>
  );
}
