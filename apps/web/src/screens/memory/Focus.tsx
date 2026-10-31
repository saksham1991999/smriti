/**
 * MEM-28 focus setup, MEM-29 focus session and MEM-30 done, on this device. Presets, rounds and
 * the long break come from config (`focus.*`); the server's notification prefs get `focus_until`
 * so no reminders arrive during focus. The tab title shows the countdown. Rounds count when the
 * session ends (`focus_session_completed`).
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppStore } from "@smriti/app-core/react";
import {
  Button,
  ChoiceChips,
  Dialog,
  PetLine,
  ProgressRing,
  StatTile,
  Text,
  TopBar,
} from "@smriti/ui-web";
import { useServices } from "../../boot/context";
import { useI18n } from "../../lib/i18n";
import { usePatchPrefs } from "../../lib/push";

type Phase = "focus" | "break" | "long_break";

interface Run {
  focusMin: number;
  breakMin: number;
  rounds: number;
  round: number;
  phase: Phase;
  /** When the current phase ends (ms), or the ms left while paused. */
  endsAt: number;
  pausedLeft: number | null;
  focusedMs: number;
  startedAt: number;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function FocusScreen() {
  const s = useServices();
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const pet = useAppStore((x) => x.pet);
  const presets = s.flags.get("focus.presets");
  const roundsBeforeLong = s.flags.get("focus.rounds_before_long_break");
  const longBreakMin = s.flags.get("focus.long_break_min");
  const patchPrefs = usePatchPrefs();
  const [preset, setPreset] = useState(Math.min(1, presets.length - 1));
  const [rounds, setRounds] = useState(roundsBeforeLong);
  const [run, setRun] = useState<Run | null>(null);
  const [done, setDone] = useState<{ minutes: number; rounds: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [now, setNow] = useState(Date.now());
  const title = useRef(document.title);
  const brand = s.variant.appName[locale];

  useEffect(() => {
    if (!run || run.pausedLeft !== null) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [run]);

  const left = run ? (run.pausedLeft ?? run.endsAt - now) : 0;
  useEffect(() => {
    const original = title.current;
    if (run)
      document.title = `${mmss(left)} · ${run.phase === "focus" ? t("memory_labs:MEM-29.focus") : t("memory_labs:MEM-29.break")}`;
    return () => {
      document.title = original;
    };
  }, [run, left, t]);

  const finish = (r: Run, early: boolean) => {
    const minutes = Math.round(r.focusedMs / 60_000);
    const roundsDone = r.phase === "focus" ? r.round - 1 : r.round;
    void s.record("focus_session_completed", { minutes, rounds: roundsDone });
    s.analytics.track("focus_ended", {
      rounds_done: String(roundsDone),
      ended_early: early ? "1" : "0",
    });
    void patchPrefs({ focus_until: null });
    setRun(null);
    setDone({ minutes, rounds: roundsDone });
  };

  // Phase changes when the countdown reaches zero.
  useEffect(() => {
    if (!run || run.pausedLeft !== null || left > 0) return;
    if (run.phase === "focus") {
      const focusedMs = run.focusedMs + run.focusMin * 60_000;
      s.analytics.track("focus_round_completed", {
        focus_min: String(run.focusMin),
        paused_ms: 0,
        away_ms_bucket: 0,
      });
      if (run.round >= run.rounds) {
        finish({ ...run, focusedMs, round: run.round + 1 }, false);
        return;
      }
      const long = run.round % roundsBeforeLong === 0;
      setRun({
        ...run,
        focusedMs,
        phase: long ? "long_break" : "break",
        endsAt: Date.now() + (long ? longBreakMin : run.breakMin) * 60_000,
      });
    } else {
      setRun({
        ...run,
        round: run.round + 1,
        phase: "focus",
        endsAt: Date.now() + run.focusMin * 60_000,
      });
    }
    // finish is stable enough for this tick; the effect re-runs on each phase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, left]);

  if (done)
    return (
      <div
        className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4 pb-6"
        data-testid="mem-30"
      >
        <TopBar onBack={() => void navigate({ to: "/learn" })} backIcon="X" />
        <main id="main" className="flex flex-col gap-4">
          <Text variant="title" heading as="h1">
            {t("memory_labs:MEM-30.title")}
          </Text>
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              value={String(done.minutes)}
              label={t("memory_labs:MEM-30.focus_min")}
              icon="Timer"
              tint
            />
            <StatTile
              value={String(done.rounds)}
              label={t("memory_labs:MEM-30.rounds")}
              icon="CheckCircle"
              tint
            />
          </div>
          <Text tone="muted">{t("memory_labs:MEM-30.spread")}</Text>
          <Button
            label={t("memory_labs:MEM-30.done")}
            onPress={() => void navigate({ to: "/learn" })}
            testID="focus-done"
          />
          <Button
            variant="secondary"
            label={t("memory_labs:MEM-30.another")}
            onPress={() => setDone(null)}
            testID="focus-another"
          />
        </main>
      </div>
    );

  if (!run) {
    const p = presets[preset] ?? presets[0] ?? { focus: 25, break: 5 };
    return (
      <div
        className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4 pb-6"
        data-testid="mem-28"
      >
        <TopBar
          title={t("memory_labs:MEM-28.title")}
          onBack={() => void navigate({ to: "/learn" })}
        />
        <main id="main" className="flex flex-col gap-4">
          <ChoiceChips
            label={t("memory_labs:MEM-28.title")}
            hideLabel
            options={presets.map((x, i) => ({
              value: String(i),
              label: t("memory_labs:MEM-28.preset", { focus: x.focus, break: x.break }),
            }))}
            value={[String(preset)]}
            onChange={(v) => v[0] && setPreset(Number(v[0]))}
            testID="focus-preset"
          />
          <div className="flex flex-col gap-2">
            <Text variant="label">{t("memory_labs:MEM-28.rounds")}</Text>
            <ChoiceChips
              label={t("memory_labs:MEM-28.rounds")}
              hideLabel
              options={[1, 2, 3, 4, 6, 8].map((n) => ({ value: String(n), label: String(n) }))}
              value={[String(rounds)]}
              onChange={(v) => v[0] && setRounds(Number(v[0]))}
              testID="focus-rounds"
            />
            <Text variant="caption" tone="muted">
              {t("memory_labs:MEM-28.long_break", { n: roundsBeforeLong })}
            </Text>
          </div>
          <Text variant="caption" tone="muted">
            {t("memory_labs:MEM-28.web_tip")} {t("memory_labs:MEM-28.our_quiet", { brand })}
          </Text>
          {pet && (
            <PetLine
              pet={{ species: pet.species === "dog" ? "dog" : "cat", mood: "happy" }}
              petName={pet.name}
              text={t("memory_labs:MEM-28.pet")}
            />
          )}
          <Button
            label={t("memory_labs:MEM-28.start")}
            onPress={() => {
              const start = Date.now();
              const total = rounds * p.focus + (rounds - 1) * p.break;
              void patchPrefs({ focus_until: new Date(start + total * 60_000).toISOString() });
              s.analytics.track("focus_started", {
                preset: "classic",
                focus_min: String(p.focus),
                break_min: String(p.break),
                dnd_requested: "0",
              });
              setNow(start);
              setRun({
                focusMin: p.focus,
                breakMin: p.break,
                rounds,
                round: 1,
                phase: "focus",
                endsAt: start + p.focus * 60_000,
                pausedLeft: null,
                focusedMs: 0,
                startedAt: start,
              });
            }}
            testID="focus-start"
          />
        </main>
      </div>
    );
  }

  const phaseMs =
    (run.phase === "focus"
      ? run.focusMin
      : run.phase === "long_break"
        ? longBreakMin
        : run.breakMin) * 60_000;
  const paused = run.pausedLeft !== null;
  return (
    <div
      className="mx-auto flex min-h-dvh max-w-[560px] flex-col gap-4 px-4 pb-6"
      data-testid="mem-29"
      data-phase={run.phase}
    >
      <TopBar
        onBack={() => setConfirm(true)}
        backIcon="X"
        title={t("memory_labs:MEM-29.round", { r: run.round, total: run.rounds })}
      />
      <main id="main" className="flex flex-col items-center gap-6">
        <Text variant="label" tone="muted">
          {run.phase === "focus"
            ? t("memory_labs:MEM-29.focus")
            : run.phase === "long_break"
              ? t("memory_labs:MEM-29.long_break")
              : t("memory_labs:MEM-29.break")}
        </Text>
        <ProgressRing
          value={1 - Math.max(0, left) / phaseMs}
          size={240}
          stroke={14}
          tone="primary"
          label={t("memory_labs:MEM-29.focus")}
          valueText={mmss(left)}
          centerText={mmss(left)}
          testID="focus-ring"
        />
        {run.phase !== "focus" && pet && (
          <PetLine
            pet={{ species: pet.species === "dog" ? "dog" : "cat", mood: "sleepy" }}
            petName={pet.name}
            text={t("memory_labs:MEM-29.pet_break")}
          />
        )}
        <div className="flex w-full flex-col gap-2">
          <Button
            label={paused ? t("memory_labs:MEM-29.resume") : t("memory_labs:MEM-29.pause")}
            onPress={() =>
              setRun(
                paused
                  ? { ...run, endsAt: Date.now() + (run.pausedLeft ?? 0), pausedLeft: null }
                  : { ...run, pausedLeft: run.endsAt - Date.now() },
              )
            }
            testID="focus-pause"
          />
          {run.phase !== "focus" && (
            <Button
              variant="secondary"
              label={t("memory_labs:MEM-29.skip_break")}
              onPress={() => setRun({ ...run, endsAt: Date.now(), pausedLeft: null })}
              testID="focus-skip-break"
            />
          )}
          <Button
            variant="ghost"
            label={t("memory_labs:MEM-29.review")}
            onPress={() => window.open("/review", "_blank", "noopener")}
            testID="focus-review"
          />
        </div>
      </main>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("memory_labs:MEM-29.end_confirm")}
        confirm={{
          label: t("memory_labs:MEM-30.done"),
          onPress: () => {
            setConfirm(false);
            const elapsed = run.phase === "focus" ? phaseMs - Math.max(0, left) : 0;
            finish({ ...run, focusedMs: run.focusedMs + elapsed }, true);
          },
        }}
        cancel={{ label: t("memory_labs:MEM-29.resume"), onPress: () => setConfirm(false) }}
        testID="focus-end"
      />
    </div>
  );
}
