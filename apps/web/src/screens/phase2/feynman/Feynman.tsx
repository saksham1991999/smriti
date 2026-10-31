/**
 * G-3 Feynman explain-back: AI-10 (explain it) and AI-11 (feedback) on one route,
 * `/tutor/feynman/$topicId?concept=`. The concepts and their key points come from the topic's
 * deep-dive bundle; the grade comes from `POST /v1/feynman/attempts`, and the band thresholds from
 * the server's `feynman.bands` flag. The explanation is a draft on this device until it's checked;
 * it is never logged or sent to analytics (AGENTS.md rule 6).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { unwrap } from "@smriti/api-client";
import { useAppStore } from "@smriti/app-core/react";
import { Button, Card, Chip, Dialog, EmptyState, Icon, Illustration, PetLine, ProgressBar, Spinner, Text, cx } from "@smriti/ui-web";
import { useServices } from "../../../boot/context";
import { findTopic, useBundle, useCatalog } from "../../../lib/content";
import { useI18n } from "../../../lib/i18n";
import { useOnline } from "../../../lib/network";
import { useIsPro } from "../../../lib/pro";
import { toast } from "../../../lib/toast";
import { LoadError, RouteLoading } from "../../../shell/States";
import { errorCode, problemField } from "../shared/errors";
import { MicDialog, useMicGate } from "../shared/mic";
import { useClose } from "../shared/nav";
import { Page, PageColumns, SectionTitle } from "../shared/Page";
import { usePet } from "../shared/pet";
import { ProTeaser } from "../shared/ProTeaser";
import { clock, useRecorder } from "../shared/recorder";
import { SafetyCard, type SafetyInfo } from "../shared/Safety";
import { addGapsToReview } from "./gaps";
import { band, bandsFrom, countWords, draftKey, gapsOf, METERS, overall, pointText, sinceLastTime, type Band, type FeynmanResult, type MeterKey } from "./logic";

type Mode = "type" | "speak";
type Phase = { kind: "explain" } | { kind: "grading"; slow: boolean } | { kind: "result"; result: FeynmanResult } | { kind: "error"; code: string | null } | { kind: "safety"; info: SafetyInfo };

export interface FeynmanSearch {
  concept?: string;
}

const DEMO_SEEN = "feynman.demo_seen";

export function Feynman() {
  const { topicId } = useParams({ from: "/tutor/feynman/$topicId" });
  const search = useSearch({ from: "/tutor/feynman/$topicId" });
  const s = useServices();
  const { t, locale } = useI18n();
  const isPro = useIsPro();
  const close = useClose(`/learn/topic/${topicId}`);
  const navigate = useNavigate();
  const catalog = useCatalog();
  const bundle = useBundle(topicId, "deep_dive");
  const loc = findTopic(catalog.subjects, topicId);
  const concepts = useMemo(() => (bundle.data?.bundle.concepts ?? []).filter((c) => c.key_points.length > 0), [bundle.data]);
  const [conceptId, setConceptId] = useState<string | null>(search.concept ?? null);
  const concept = concepts.find((c) => c.id === conceptId) ?? concepts[0] ?? null;
  const [phase, setPhase] = useState<Phase>({ kind: "explain" });
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("type");
  const [demo, setDemo] = useState(false);
  const attemptId = useRef<string>(crypto.randomUUID());
  const bands = bandsFrom(s.flags.get("feynman.bands"));

  // The draft for this concept comes back when the concept changes (or the page reloads).
  useEffect(() => {
    if (!concept) return;
    let live = true;
    void s.kv.get(draftKey(concept.id)).then((v) => live && setText(v ?? ""));
    attemptId.current = crypto.randomUUID();
    return () => {
      live = false;
    };
  }, [concept, s]);

  useEffect(() => {
    if (!concept) return;
    const id = window.setTimeout(() => void (text ? s.kv.set(draftKey(concept.id), text) : s.kv.delete(draftKey(concept.id))), 400);
    return () => window.clearTimeout(id);
  }, [text, concept, s]);

  useEffect(() => {
    if (!isPro || !concept) return;
    void s.kv.get(DEMO_SEEN).then((v) => {
      if (!v) {
        setDemo(true);
        void s.kv.set(DEMO_SEEN, "1");
      }
    });
  }, [isPro, concept, s]);

  if (!isPro) return <ProTeaser tool="feynman" onClose={close} />;
  if (catalog.isError || bundle.isError) return <Page onBack={close} backIcon="X" title={t("tutor_social:AI-10.title")}><LoadError onRetry={() => void (catalog.isError ? catalog.refetch() : bundle.refetch())} /></Page>;
  if (catalog.isPending || bundle.isPending) return <RouteLoading />;
  if (!concept) {
    return (
      <Page onBack={close} backIcon="X" title={t("tutor_social:AI-10.title")} testID="ai-10-empty">
        <EmptyState illustration="ui-search-empty" text={t("tutor_social:AI-10.no_concepts")} action={{ label: t("tutor_social:AI-11.done"), onPress: close }} />
      </Page>
    );
  }

  const submit = async (explanation: string, followUpOf?: string) => {
    const online = navigator.onLine;
    if (!online) {
      toast.show(t("tutor_social:AI-10.offline"));
      return null;
    }
    if (!followUpOf) {
      setPhase({ kind: "grading", slow: false });
      s.analytics.track("feynman_submitted", { input: mode === "speak" ? "voice" : "typed" });
    }
    const slow = window.setTimeout(() => setPhase((p) => (p.kind === "grading" ? { kind: "grading", slow: true } : p)), 20_000);
    try {
      const result = await unwrap(
        s.client.POST("/v1/feynman/attempts", {
          body: {
            client_attempt_id: followUpOf ? crypto.randomUUID() : attemptId.current,
            concept_id: concept.id,
            explanation,
            input_mode: mode === "speak" ? "voice" : "text",
            ...(followUpOf ? { follow_up_of: followUpOf } : {}),
          },
        }),
        s.client,
      );
      if (!followUpOf) {
        void s.kv.delete(draftKey(concept.id));
        attemptId.current = crypto.randomUUID();
      }
      setPhase({ kind: "result", result });
      return result;
    } catch (e) {
      const code = errorCode(e);
      if (code === "feynman_safety") {
        setPhase({ kind: "safety", info: { kind: problemField(e, "kind") === "crisis" ? "crisis" : "refusal", helplines: problemField(e, "helplines") } });
      } else if (!followUpOf) setPhase({ kind: "error", code });
      else toast.show(t("tutor_social:AI-11.follow_up_failed"));
      return null;
    } finally {
      window.clearTimeout(slow);
    }
  };

  if (phase.kind === "safety") {
    return (
      <Page onBack={close} backIcon="X" title={t("tutor_social:AI-10.title")} testID="ai-08">
        <SafetyCard info={phase.info} topicTitle={loc?.topic.name ?? bundle.data?.bundle.topic.name ?? ""} onBack={() => setPhase({ kind: "explain" })} />
      </Page>
    );
  }
  if (phase.kind === "grading") return <Grading slow={phase.slow} onClose={close} />;
  if (phase.kind === "result") {
    return (
      <Feedback
        result={phase.result}
        bands={bands}
        locale={locale}
        conceptName={concept.name}
        onClose={close}
        onTryAgain={() => {
          setText("");
          setPhase({ kind: "explain" });
        }}
        onFollowUp={(answer) => submit(answer, phase.result.id)}
        onLearn={() => {
          // LES-01 at the first bite that teaches this concept (or the start of the lesson).
          const b = bundle.data?.bundle;
          const bite = b?.bites.find((x) => x.card_ids.some((id) => b.cards.some((c) => c.id === id && c.concepts.includes(concept.id))));
          void navigate({ to: "/lesson/$topicId", params: { topicId }, search: { mode: "deep_dive", bite: bite?.id } });
        }}
        onAddGaps={async () => {
          const n = await addGapsToReview(s, { result: phase.result, conceptName: concept.name, topicId, deckTitle: t("tutor_social:AI-11.tutor_deck_name"), locale });
          toast.show(t("tutor_social:AI-11.added_toast", { n }));
        }}
      />
    );
  }

  return (
    <>
      <Explain
        subject={loc?.subject.family}
        concepts={concepts.map((c) => ({ id: c.id, name: c.name }))}
        conceptId={concept.id}
        conceptName={concept.name}
        onConcept={(id) => {
          setConceptId(id);
          setPhase({ kind: "explain" });
        }}
        mode={mode}
        onMode={(m) => {
          setMode(m);
          s.analytics.track("feynman_started", { input: m === "speak" ? "voice" : "typed" });
        }}
        text={text}
        onText={setText}
        minWords={s.flags.get("feynman.min_words")}
        maxRecordSeconds={s.flags.get("feynman.max_record_seconds")}
        error={phase.kind === "error" ? phase.code : null}
        onSubmit={() => void submit(text.trim())}
        onClose={close}
        onHelp={() => setDemo(true)}
      />
      <Demo open={demo} onClose={() => setDemo(false)} />
    </>
  );
}

// ── AI-10 ────────────────────────────────────────────────────────────────

function Explain(p: {
  subject?: string;
  concepts: { id: string; name: string }[];
  conceptId: string;
  conceptName: string;
  onConcept: (id: string) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  text: string;
  onText: (v: string) => void;
  minWords: number;
  maxRecordSeconds: number;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
  onHelp: () => void;
}) {
  const { t } = useI18n();
  const online = useOnline();
  const pet = usePet();
  const band = useAppStore((x) => x.profile?.age_band ?? null);
  const speakAllowed = band !== "u10" && band !== "10_12";
  const words = countWords(p.text);
  const ready = words >= p.minWords;
  const petName = pet?.name ?? t("tutor_social:AI-13.pet_fallback");
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && ready && online) {
      e.preventDefault();
      p.onSubmit();
    }
  };

  const left = (
    <>
      <div className={cx("flex items-center gap-3 overflow-hidden rounded-card-large bg-subject-tint p-4")} data-subject={p.subject}>
        <Text variant="heading" as="p" className="min-w-0 flex-1">
          {t("tutor_social:AI-10.prompt", { concept_title: p.conceptName })}
        </Text>
        <Illustration name="scene-student-laptop" alt={t("tutor_social:AI-10.hero_alt", { pet_name: petName })} width={128} height={96} className="shrink-0" />
      </div>
      {p.concepts.length > 1 && (
        <div role="radiogroup" aria-label={t("tutor_social:AI-10.concept_picker_label")} className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-testid="ai-10-concepts">
          {p.concepts.map((c) => (
            <Chip key={c.id} kind="filter" label={c.name} selected={c.id === p.conceptId} onPress={() => p.onConcept(c.id)} role="radio" testID={`concept-${c.id}`} />
          ))}
        </div>
      )}
      {pet && <PetLine pet={{ species: pet.species }} petName={pet.name} text={t("tutor_social:AI-10.tip_pet_line")} className="max-[599px]:hidden" />}
    </>
  );

  const right = (
    <>
      {speakAllowed && (
        <div role="radiogroup" aria-label={t("tutor_social:AI-10.mode_label")} className="flex gap-1 self-start rounded-full bg-surface-sunken p-1">
          <Chip kind="filter" role="radio" label={t("tutor_social:AI-10.type")} icon="Keyboard" selected={p.mode === "type"} onPress={() => p.onMode("type")} testID="mode-type" />
          <Chip kind="filter" role="radio" label={t("tutor_social:AI-10.speak")} icon="Microphone" selected={p.mode === "speak"} onPress={() => p.onMode("speak")} testID="mode-speak" />
        </div>
      )}
      {p.mode === "speak" && speakAllowed ? (
        <SpeakPanel text={p.text} onText={p.onText} maxSeconds={p.maxRecordSeconds} onKey={onKey} />
      ) : (
        <label className="flex flex-col gap-2">
          <span className="sr-only">{t("tutor_social:AI-10.prompt", { concept_title: p.conceptName })}</span>
          <textarea
            value={p.text}
            onChange={(e) => p.onText(e.target.value)}
            onKeyDown={onKey}
            rows={8}
            maxLength={4000}
            className="min-h-[168px] w-full resize-y min-[600px]:min-h-[320px] rounded-[16px] border border-line bg-surface-sunken p-4 text-body text-ink outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary"
            data-testid="ai-10-text"
          />
        </label>
      )}
      <p aria-live="polite" className={cx("m-0 text-caption tabular-nums", ready ? "text-success-text" : "text-ink-muted")} data-testid="ai-10-counter">
        {t("tutor_social:AI-10.word_counter", { n: words, min: p.minWords })}
      </p>
      {pet && <PetLine pet={{ species: pet.species }} petName={pet.name} text={t("tutor_social:AI-10.tip_pet_line")} className="min-[600px]:hidden" />}
      {p.error && (
        <div role="alert" className="rounded-card bg-error-tint p-3 text-error-text" data-testid="ai-10-error">
          <Text tone="error">{p.error === "too_short" ? t("tutor_social:AI-10.too_short", { min: p.minWords }) : t("tutor_social:AI-10.grade_failed")}</Text>
        </div>
      )}
    </>
  );

  return (
    <Page
      onBack={p.onClose}
      backIcon="X"
      title={t("tutor_social:AI-10.title")}
      actions={[{ icon: "Question", label: t("tutor_social:AI-10.help_icon_label"), onPress: p.onHelp }]}
      width="lg"
      testID="ai-10"
      footer={
        <>
          {!online && (
            <Text variant="caption" tone="muted" align="center" testID="ai-10-offline">
              {t("tutor_social:AI-10.offline")}
            </Text>
          )}
          <div className="flex items-center gap-3">
            <Button label={t("tutor_social:AI-10.submit")} onPress={p.onSubmit} disabled={!ready || !online} fullWidth testID="ai-10-submit" />
          </div>
          <Text variant="caption" tone="muted" align="center" className="max-[599px]:hidden">
            {t("tutor_social:AI-10.shortcut_hint")}
          </Text>
        </>
      }
    >
      <PageColumns left={left} right={right} />
    </Page>
  );
}

function SpeakPanel({ text, onText, maxSeconds, onKey }: { text: string; onText: (v: string) => void; maxSeconds: number; onKey: (e: KeyboardEvent) => void }) {
  const { t, locale } = useI18n();
  const s = useServices();
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const gate = useMicGate((result) => s.analytics.track("voice_permission_result", { result: result === "granted" ? "granted" : "denied" }));
  const pressedAt = useRef(0);
  const toggled = useRef(false);

  const transcribe = async (blob: Blob | null) => {
    if (!blob) return;
    setBusy(true);
    setNote(null);
    try {
      const out = await unwrap(
        s.client.POST("/v1/speech/dictation", {
          params: { query: { locale } },
          body: blob as unknown as string,
          bodySerializer: (b: unknown) => b as Blob,
          headers: { "Content-Type": blob.type || "audio/webm" },
        }),
        s.client,
      );
      if (out.text) onText(text ? `${text.trimEnd()} ${out.text}` : out.text);
    } catch (e) {
      const code = errorCode(e);
      setNote(code === "guardian_consent_required" ? t("tutor_social:AI-10.voice_scope_note") : code === "audio_too_large" ? t("tutor_social:AI-10.recording_limit", { max_min: Math.round(maxSeconds / 60) }) : t("tutor_social:AI-10.transcribe_failed"));
    } finally {
      setBusy(false);
    }
  };
  const rec = useRecorder(maxSeconds, (b) => void transcribe(b));
  const recording = rec.state === "recording";

  const begin = async () => {
    if (recording || busy) return;
    const stream = await gate.request();
    if (stream && !rec.start(stream)) stream.getTracks().forEach((tr) => tr.stop());
  };
  const end = async () => {
    const blob = await rec.stop();
    await transcribe(blob);
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-card bg-surface p-4" data-testid="ai-10-speak">
      <button
        type="button"
        aria-label={t("tutor_social:AI-10.record_a11y")}
        aria-pressed={recording}
        disabled={!online || busy}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          pressedAt.current = Date.now();
          toggled.current = recording;
          if (!recording) void begin();
        }}
        onPointerUp={() => {
          const held = Date.now() - pressedAt.current;
          // Held: stop on release. A quick tap toggles (the accessible alternative).
          if (held > 350 || toggled.current) void end();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void (recording ? end() : begin());
          }
        }}
        className={cx(
          "grid size-24 place-items-center rounded-full bg-primary text-on-primary shadow-cta transition-transform outline-none focus-visible:outline-[3px] focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-50 motion-reduce:transition-none",
          recording && "scale-[1.08] motion-reduce:scale-100",
        )}
        data-testid="ai-10-record"
      >
        <Icon name="Microphone" size={32} />
      </button>
      <Text variant="label" tone="muted">
        {!online ? t("tutor_social:AI-10.speak_offline") : recording ? clock(rec.seconds) : t("tutor_social:AI-10.hold_to_record")}
      </Text>
      {recording && <LevelBars level={rec.level} />}
      <Text variant="caption" tone="muted" numeric>
        {t("tutor_social:AI-10.recording_limit", { max_min: Math.round(maxSeconds / 60) })}
      </Text>
      {busy && (
        <div className="flex items-center gap-2" role="status">
          <Spinner label={t("tutor_social:AI-10.transcribing")} />
          <Text variant="caption" tone="muted">
            {t("tutor_social:AI-10.transcribing")}
          </Text>
        </div>
      )}
      {note && (
        <p role="alert" className="m-0 text-caption text-warning-text">
          {note}
        </p>
      )}
      <label className="flex w-full flex-col gap-1">
        <Text variant="label">{t("tutor_social:AI-10.transcript_label")}</Text>
        <textarea value={text} onChange={(e) => onText(e.target.value)} onKeyDown={onKey} rows={5} maxLength={4000} className="w-full resize-y rounded-[16px] border border-line bg-surface-sunken p-3 text-body text-ink outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary" data-testid="ai-10-transcript" />
      </label>
      <MicDialog state={gate.dialog} onAllow={() => void gate.allow()} onDismiss={gate.dismiss} />
    </div>
  );
}

/** The input level as five bars (a static bar meter; no motion needed). */
function LevelBars({ level }: { level: number }) {
  return (
    <div className="flex h-6 items-end gap-1" aria-hidden="true">
      {[0.2, 0.4, 0.6, 0.8, 1].map((th) => (
        <span key={th} className={cx("w-1.5 rounded-full", level >= th * 0.8 ? "bg-primary" : "bg-track")} style={{ height: `${8 + th * 16}px` }} />
      ))}
    </div>
  );
}

// ── Grading ──────────────────────────────────────────────────────────────

function Grading({ slow, onClose }: { slow: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Page onBack={onClose} backIcon="X" title={t("tutor_social:AI-11.title")} width="lg" testID="ai-11-grading">
      <div className="flex flex-col gap-4" role="status" aria-live="polite">
        <Text tone="muted">{slow ? t("tutor_social:AI-02.slow_answer") : t("tutor_social:AI-11.grading")}</Text>
        {METERS.map((m) => (
          <div key={m} className="flex flex-col gap-2">
            <div className="h-4 w-28 animate-pulse rounded-full bg-surface-sunken motion-reduce:animate-none" />
            <div className="h-2 w-full animate-pulse rounded-full bg-track motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </Page>
  );
}

// ── AI-11 ────────────────────────────────────────────────────────────────

const BAND_ICON: Record<Band, "WarningCircle" | "ArrowUp" | "CheckCircle"> = { needs_work: "WarningCircle", getting_there: "ArrowUp", clear: "CheckCircle" };
const BAND_KEY = { needs_work: "tutor_social:AI-11.bands.1", getting_there: "tutor_social:AI-11.bands.2", clear: "tutor_social:AI-11.bands.3" } as const;
const METER_KEY: Record<MeterKey, "tutor_social:AI-11.meters.1" | "tutor_social:AI-11.meters.2" | "tutor_social:AI-11.meters.3"> = {
  clarity: "tutor_social:AI-11.meters.1",
  completeness: "tutor_social:AI-11.meters.2",
  accuracy: "tutor_social:AI-11.meters.3",
};

function Feedback({
  result,
  bands,
  locale,
  conceptName,
  onClose,
  onTryAgain,
  onFollowUp,
  onLearn,
  onAddGaps,
}: {
  result: FeynmanResult;
  bands: ReturnType<typeof bandsFrom>;
  locale: "en" | "hi";
  conceptName: string;
  onClose: () => void;
  onTryAgain: () => void;
  onFollowUp: (answer: string) => Promise<FeynmanResult | null>;
  onLearn: () => void;
  onAddGaps: () => Promise<void>;
}) {
  const { t } = useI18n();
  const s = useServices();
  const pet = usePet();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [answered, setAnswered] = useState(0);
  const verdict = overall(result, bands);
  const gaps = gapsOf(result);
  const noGaps = gaps.missed.length + gaps.wrong.length === 0;
  const delta = sinceLastTime(result);
  const tracked = useRef(false);
  useEffect(() => {
    if (tracked.current) return;
    tracked.current = true;
    s.analytics.track("feynman_completed", {
      clarity_band: band(result.clarity, bands),
      completeness_band: band(result.completeness, bands),
      accuracy_band: band(result.accuracy, bands),
      gaps_count: gaps.missed.length + gaps.wrong.length,
      followups_answered: answered,
    });
  }, [s, result, bands, gaps.missed.length, gaps.wrong.length, answered]);

  const petLine = verdict === "all_clear" ? t("tutor_social:AI-11.pet_line_all_clear") : verdict === "mixed" ? t("tutor_social:AI-11.pet_line_mixed") : t("tutor_social:AI-11.pet_line_needs_work");
  const mood = verdict === "all_clear" ? "proud" : verdict === "mixed" ? "thinking" : "curious";

  const left = (
    <>
      {pet ? <PetLine pet={{ species: pet.species, mood }} petName={pet.name} text={petLine} testID="ai-11-pet" /> : <Text variant="heading">{petLine}</Text>}
      <Text variant="label" tone="muted">
        {conceptName}
      </Text>
      <div className="flex flex-col gap-4" data-testid="ai-11-meters">
        {METERS.map((m) => {
          const b = band(result[m], bands);
          return (
            <div key={m} className="flex flex-col gap-2" data-testid={`meter-${m}`} data-band={b}>
              <div className="flex items-center gap-2">
                <Text variant="label" className="flex-1">
                  {t(METER_KEY[m])}
                </Text>
                <span className={cx("inline-flex items-center gap-1 text-label", b === "clear" ? "text-success-text" : b === "getting_there" ? "text-primary-text" : "text-warning-text")}>
                  <Icon name={BAND_ICON[b]} size={16} />
                  {t(BAND_KEY[b])}
                </span>
                <Text variant="caption" tone="muted" numeric>
                  {t("tutor_social:AI-11.score", { score: result[m] })}
                </Text>
              </div>
              <ProgressBar value={result[m] / 100} tone="primary" label={t("tutor_social:AI-11.meter_a11y", { meter: t(METER_KEY[m]), band: t(BAND_KEY[b]), score: result[m] })} />
            </div>
          );
        })}
      </div>
      {delta !== null && (
        <span className="inline-flex items-center gap-1 text-label text-success-text" data-testid="ai-11-delta">
          <Icon name="ArrowUp" size={16} />
          {t("tutor_social:AI-11.since_last_time", { n: delta })}
        </span>
      )}
    </>
  );

  const right = (
    <>
      {noGaps ? (
        <Card tone="tint" testID="ai-11-no-gaps">
          <div className="flex items-center gap-3">
            <Icon name="CheckCircle" size={24} className="text-success-text" />
            <Text>{t("tutor_social:AI-11.no_gaps")}</Text>
          </div>
        </Card>
      ) : (
        <>
          {gaps.missed.length > 0 && (
            <section aria-labelledby="ai-11-missed" className="flex flex-col gap-2" data-testid="ai-11-missed">
              <SectionTitle id="ai-11-missed">{t("tutor_social:AI-11.you_missed")}</SectionTitle>
              {gaps.missed.map((k) => (
                <GapRow key={k.index} text={pointText(k, locale)} onLearn={onLearn} />
              ))}
            </section>
          )}
          {gaps.wrong.length > 0 && (
            <section aria-labelledby="ai-11-wrong" className="flex flex-col gap-2" data-testid="ai-11-wrong">
              <SectionTitle id="ai-11-wrong">{t("tutor_social:AI-11.not_quite_right")}</SectionTitle>
              {gaps.wrong.map((k) => (
                <GapRow key={k.index} text={pointText(k, locale)} note={k.note ?? undefined} onLearn={onLearn} />
              ))}
            </section>
          )}
        </>
      )}
      {result.follow_ups.length > 0 && (
        <section aria-labelledby="ai-11-asks" className="flex flex-col gap-2" data-testid="ai-11-follow-ups">
          <SectionTitle id="ai-11-asks">{t("tutor_social:AI-11.follow_ups_header", { pet_name: pet?.name ?? t("tutor_social:AI-13.pet_fallback") })}</SectionTitle>
          {result.follow_ups.map((q, i) => (
            <FollowUp
              key={`${result.id}-${i}`}
              question={q}
              index={i}
              onSend={async (a) => {
                const r = await onFollowUp(a);
                if (r) setAnswered((n) => n + 1);
                return !!r;
              }}
            />
          ))}
        </section>
      )}
    </>
  );

  return (
    <Page
      onBack={onClose}
      backIcon="X"
      title={t("tutor_social:AI-11.title")}
      trailing={!noGaps ? <Button label={t("tutor_social:AI-11.done")} variant="ghost" size="sm" onPress={onClose} testID="ai-11-done-top" /> : undefined}
      width="lg"
      testID="ai-11"
      footer={
        noGaps ? (
          <div className="flex flex-col gap-2 min-[600px]:flex-row-reverse">
            <Button label={t("tutor_social:AI-11.done")} onPress={onClose} testID="ai-11-done" />
            <Button label={t("tutor_social:AI-11.try_again")} variant="secondary" onPress={onTryAgain} testID="ai-11-try-again" />
          </div>
        ) : (
          <div className="flex flex-col gap-2 min-[600px]:flex-row-reverse">
            <Button
              label={added ? t("tutor_social:AI-11.added_label") : t("tutor_social:AI-11.add_gaps")}
              icon={added ? "Check" : "Cards"}
              loading={adding}
              disabled={added}
              onPress={async () => {
                setAdding(true);
                try {
                  await onAddGaps();
                  setAdded(true);
                } finally {
                  setAdding(false);
                }
              }}
              testID="ai-11-add-gaps"
            />
            <Button label={t("tutor_social:AI-11.try_again")} variant="secondary" onPress={onTryAgain} testID="ai-11-try-again" />
          </div>
        )
      }
    >
      <PageColumns left={left} right={right} />
    </Page>
  );
}

function GapRow({ text, note, onLearn }: { text: string; note?: string; onLearn: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-2 rounded-[16px] border border-line bg-surface p-4 min-[600px]:flex-row min-[600px]:items-center">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Text>{text}</Text>
        {note && (
          <Text variant="caption" tone="muted">
            {note}
          </Text>
        )}
      </div>
      <Button label={t("tutor_social:AI-11.learn_this")} variant="ghost" size="sm" icon="BookBookmark" onPress={onLearn} className="self-start min-[600px]:self-center" />
    </div>
  );
}

function FollowUp({ question, index, onSend }: { question: string; index: number; onSend: (answer: string) => Promise<boolean> }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const id = `follow-up-${index}`;
  return (
    <div className="flex flex-col gap-2 rounded-[16px] bg-surface-sunken p-4" data-testid={id}>
      <Text>{question}</Text>
      {state === "sent" ? (
        <span className="inline-flex items-center gap-1 text-label text-success-text">
          <Icon name="Check" size={16} />
          {t("tutor_social:AI-11.follow_up_sent")}
        </span>
      ) : !open ? (
        <Button label={t("tutor_social:AI-11.answer")} variant="ghost" size="sm" icon="ChatCircleText" onPress={() => setOpen(true)} className="self-start" testID={`${id}-open`} />
      ) : (
        <div className="flex flex-col gap-2">
          <label className="sr-only" htmlFor={`${id}-input`}>
            {question}
          </label>
          <textarea id={`${id}-input`} value={value} onChange={(e) => setValue(e.target.value)} rows={3} maxLength={4000} className="w-full rounded-[12px] border border-line bg-surface p-3 text-body text-ink outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary" data-testid={`${id}-input`} />
          <Button
            label={t("tutor_social:AI-02.send")}
            size="sm"
            icon="PaperPlaneRight"
            className="self-end"
            loading={state === "sending"}
            disabled={!value.trim()}
            onPress={async () => {
              setState("sending");
              setState((await onSend(value.trim())) ? "sent" : "idle");
            }}
            testID={`${id}-send`}
          />
        </div>
      )}
    </div>
  );
}

// ── First-time demo (about 10 seconds, replayed from "?") ─────────────────

function Demo({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const pet = usePet();
  const [fill, setFill] = useState(0);
  useEffect(() => {
    if (!open) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setFill(1);
      return;
    }
    setFill(0);
    const started = Date.now();
    const id = window.setInterval(() => {
      const f = Math.min(1, (Date.now() - started) / 8000);
      setFill(f);
      if (Date.now() - started > 10_000) onClose();
    }, 200);
    return () => window.clearInterval(id);
  }, [open, onClose]);
  const values: Record<MeterKey, number> = { clarity: 0.8, completeness: 0.6, accuracy: 0.9 };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()} title={t("tutor_social:AI-10.demo_title")} cancel={{ label: t("tutor_social:AI-10.demo_skip"), onPress: onClose }} testID="ai-10-demo">
      <div className="flex flex-col gap-3">
        {pet && <PetLine pet={{ species: pet.species }} petName={pet.name} text={t("tutor_social:AI-10.demo_line")} live={false} />}
        {METERS.map((m) => (
          <ProgressBar key={m} value={values[m] * fill} tone="primary" label={t(METER_KEY[m])} valueText={t(METER_KEY[m])} />
        ))}
        <Text variant="caption" tone="muted">
          {t("tutor_social:AI-10.demo_body")}
        </Text>
      </div>
    </Dialog>
  );
}
