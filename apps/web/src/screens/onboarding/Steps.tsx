/**
 * Onboarding question steps (onboarding flow §5): ONB-02 goal, ONB-03 class, ONB-04 birth year,
 * ONB-06 exam date, ONB-07 level, ONB-10 buddy and ONB-12 plant. Each answer is saved locally at
 * once and sent through the outbox as `onboarding_answer`, in the API's value formats.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Chip, ChoiceChips, Illustration, OptionCard, Picker, PlantView, Text } from "@smriti/ui-web";
import type { Services } from "../../boot/services";
import { useServices } from "../../boot/context";
import { StepFrame } from "../../components/Frame";
import { TextField } from "../../components/Field";
import { useCatalog } from "../../lib/content";
import { parts, useI18n } from "../../lib/i18n";
import { namePet, plantSeed } from "../../lib/learner";
import { isSchoolProfile, nextStep, questionSteps, useOnboarding, type AnswerValue, type Level, type QuestionStep } from "../../lib/onboarding";
import { useExams, type Exam } from "../../lib/queries";
import { NotFound } from "../../shell/States";

type Step = QuestionStep | "plant";
const STEPS: Step[] = ["goal", "class", "birth-year", "exam-date", "level", "buddy", "plant"];

/** `onboarding_answer` with the server's value formats (the app-core payload type is narrower). */
function answer(s: Services, step: "goal" | "class" | "birth_year" | "exam_date" | "level" | "daily_goal" | "reminder", value: AnswerValue) {
  return s.record("onboarding_answer", { step, value } as never);
}

const activeProfile = (e: Exam) => e.profiles.find((p) => p.is_active)?.id ?? e.profiles[0]?.id ?? null;

const CATEGORY_ART: Record<string, string> = {
  engineering: "subject-physics",
  medical: "subject-biology",
  civil_services: "subject-polity",
  government_jobs: "subject-reasoning",
  school: "subject-english",
};

export function OnboardingStep() {
  const { step } = useParams({ strict: false }) as { step?: string };
  const s = useServices();
  const d = useOnboarding();
  const navigate = useNavigate();
  const current = (STEPS as string[]).includes(step ?? "") ? (step as Step) : null;
  const steps = questionSteps(d);
  const index = current && current !== "plant" ? steps.indexOf(current) : -1;

  useEffect(() => {
    if (current) s.analytics.track("onboarding_step_viewed", { step: current, step_index: index + 1, step_total: steps.length });
  }, [current, index, s, steps.length]);

  if (!current) return <NotFound />;
  const go = (next: Step) => void navigate({ to: "/onboarding/$step", params: { step: next } });
  const advance = (from: QuestionStep) => go(nextStep(useOnboarding.getState(), from));
  const back = () => {
    if (index <= 0 && current !== "plant") void navigate({ to: "/welcome" });
    else if (current === "plant") go("buddy");
    else go(steps[index - 1] ?? "goal");
  };
  const progress = index >= 0 ? { done: index, total: steps.length } : undefined;
  const props = { s, back, advance, progress };
  switch (current) {
    case "goal":
      return <GoalStep {...props} />;
    case "class":
      return <ClassStep {...props} />;
    case "birth-year":
      return <BirthYearStep {...props} />;
    case "exam-date":
      return <ExamDateStep {...props} />;
    case "level":
      return <LevelStep {...props} />;
    case "buddy":
      return <BuddyStep {...props} />;
    case "plant":
      return <PlantStep s={s} back={back} />;
  }
}

interface StepProps {
  s: Services;
  back: () => void;
  advance: (from: QuestionStep) => void;
  progress?: { done: number; total: number };
}

function usePet() {
  const { t } = useI18n();
  const d = useOnboarding();
  const species = d.petSpecies ?? "cat";
  return { species, name: d.petName ?? t(species === "cat" ? "onboarding:ONB-10.cat_card" : "onboarding:ONB-10.dog_card") };
}

/** ONB-02: what are you preparing for? Exams from the live catalogue (R7), plus School and Just curious. */
function GoalStep({ s, back, advance, progress }: StepProps) {
  const { t, locale } = useI18n();
  const d = useOnboarding();
  const exams = useExams();
  const pet = usePet();
  const [picked, setPicked] = useState<string[]>(() => d.goals.filter((g) => !isSchoolProfile(g)));
  const [school, setSchool] = useState(d.school);
  const cards = (exams.data ?? []).filter((e) => !/^cbse-\d+$/.test(e.id) && activeProfile(e));
  const last = picked[picked.length - 1];
  const lastExam = cards.find((e) => activeProfile(e) === last);
  const count = picked.length + (school ? 1 : 0);
  const reaction =
    count === 0
      ? t("onboarding:ONB-02.pet_line_before_a_tap", { n: questionSteps({ goals: picked, classNo: null, school }).length })
      : count > 1
        ? t("onboarding:ONB-02.reaction_several_goals", { count })
        : last === "curious"
          ? t("onboarding:ONB-02.reaction_curious")
          : school && !last
            ? t("onboarding:ONB-02.school_card")
            : t(`onboarding:ONB-02.reaction_${["engineering", "medical", "civil_services", "government_jobs"].includes(lastExam?.category ?? "") ? (lastExam?.category as "engineering") : "curious"}`);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const submit = () => {
    const schoolGoals = school ? d.goals.filter(isSchoolProfile) : [];
    const goals = [...picked, ...schoolGoals];
    useOnboarding.getState().update({ goals, school, classNo: school ? d.classNo : null });
    const ids = goals.filter((g) => g !== "curious");
    void answer(s, "goal", ids.length ? ids : "curious");
    advance("goal");
  };
  return (
    <StepFrame
      testID="onb-02"
      onBack={back}
      progress={progress}
      title={t("onboarding:ONB-02.headline")}
      helper={t("onboarding:ONB-02.helper")}
      pet={{ ...pet, text: reaction }}
      primary={{ label: t("onboarding:ONB-02.primary"), onPress: submit, disabled: count === 0, testID: "goal-continue" }}
    >
      <div role="group" aria-label={t("onboarding:ONB-02.headline")} className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {cards.map((e) => {
          const id = activeProfile(e) as string;
          return (
            <OptionCard
              key={e.id}
              kind="choice"
              multiple
              label={e.name[locale] ?? e.name.en ?? ""}
              illustration={CATEGORY_ART[e.category] ?? "subject-reasoning"}
              state={picked.includes(id) ? "selected" : "idle"}
              onPress={() => toggle(id)}
              testID={`goal-${e.id}`}
            />
          );
        })}
        <OptionCard
          kind="choice"
          multiple
          label={school && d.classNo ? t("onboarding:ONB-02.school_card_picked", { n: d.classNo }) : t("onboarding:ONB-02.school_card")}
          description={t("onboarding:ONB-02.school_caption", { range: "1–12" })}
          illustration="subject-english"
          state={school ? "selected" : "idle"}
          onPress={() => setSchool((x) => !x)}
          testID="goal-school"
        />
        <OptionCard
          kind="choice"
          multiple
          label={t("onboarding:ONB-02.curious_card")}
          description={t("onboarding:ONB-02.curious_caption")}
          illustration="ui-search-empty"
          state={picked.includes("curious") ? "selected" : "idle"}
          onPress={() => toggle("curious")}
          testID="goal-curious"
        />
      </div>
    </StepFrame>
  );
}

/** ONB-03: which class? Classes 9–12 pick up the board's exam profile from the catalogue. */
function ClassStep({ s, back, advance, progress }: StepProps) {
  const { t } = useI18n();
  const d = useOnboarding();
  const exams = useExams();
  const pet = usePet();
  const [value, setValue] = useState<number | null>(d.classNo);
  const group = (label: string, from: number, to: number) => (
    <ChoiceChips
      label={label}
      options={Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: String(from + i) }))}
      value={value ? [String(value)] : []}
      onChange={(v) => setValue(v[0] ? Number(v[0]) : null)}
      testID={`class-${from}`}
    />
  );
  const submit = () => {
    if (!value) return;
    const board = (exams.data ?? []).find((e) => e.id === `cbse-${value}`);
    const profile = board ? activeProfile(board) : null;
    const goals = [...d.goals.filter((g) => !isSchoolProfile(g)), ...(profile ? [profile] : [])];
    useOnboarding.getState().update({ classNo: value, goals });
    void answer(s, "class", value);
    const ids = goals.filter((g) => g !== "curious");
    if (profile) void answer(s, "goal", ids);
    advance("class");
  };
  return (
    <StepFrame
      testID="onb-03"
      onBack={back}
      progress={progress}
      title={t("onboarding:ONB-03.title")}
      pet={value ? { ...pet, text: t("onboarding:ONB-02.reaction_school", { n: value }) } : undefined}
      primary={{ label: t("onboarding:ONB-02.primary"), onPress: submit, disabled: !value, testID: "class-continue" }}
    >
      {group(t("onboarding:ONB-03.group_little_learners"), 1, 5)}
      {group(t("onboarding:ONB-03.group_middle"), 6, 8)}
      {group(t("onboarding:ONB-03.group_senior"), 9, 12)}
    </StepFrame>
  );
}

/** ONB-04: birth year. The age band drives the DPDP defaults; "Prefer not to say" uses under-18 settings. */
function BirthYearStep({ s, back, advance, progress }: StepProps) {
  const { t } = useI18n();
  const d = useOnboarding();
  const pet = usePet();
  const now = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 76 }, (_, i) => String(now - 5 - i)), [now]);
  const [year, setYear] = useState<string | null>(typeof d.birthYear === "number" ? String(d.birthYear) : null);
  const submit = (value: number | "prefer_not") => {
    useOnboarding.getState().update({ birthYear: value });
    void answer(s, "birth_year", value === "prefer_not" ? null : value);
    advance("birth-year");
  };
  return (
    <StepFrame
      testID="onb-04"
      onBack={back}
      progress={progress}
      title={t("onboarding:ONB-04.headline")}
      helper={t("onboarding:ONB-04.helper")}
      pet={{ ...pet, text: year ? t("onboarding:ONB-04.pet_reaction") : t("onboarding:ONB-04.pet_line_first_question", { n: progress?.total ?? 1 }) }}
      primary={{ label: t("onboarding:ONB-04.primary"), onPress: () => year && submit(Number(year)), disabled: !year, testID: "birth-continue" }}
      secondary={{ label: t("onboarding:ONB-04.decline"), onPress: () => submit("prefer_not"), testID: "birth-decline" }}
    >
      <Picker label={t("onboarding:ONB-04.headline")} options={years.map((y) => ({ value: y, label: y }))} value={year} onChange={setYear} testID="birth-year" />
    </StepFrame>
  );
}

/** ONB-06: exam month, or "Not sure yet". The month comes from the student, never guessed (rule 3). */
function ExamDateStep({ s, back, advance, progress }: StepProps) {
  const { t, locale } = useI18n();
  const d = useOnboarding();
  const exams = useExams();
  const pet = usePet();
  const [month, setMonth] = useState<string>(d.examMonth ?? "");
  const [notSure, setNotSure] = useState(false);
  const main = d.goals.find((g) => g !== "curious");
  const exam = (exams.data ?? []).find((e) => e.profiles.some((p) => p.id === main));
  const profile = exam?.profiles.find((p) => p.id === main);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const board = d.classNo === 10 || d.classNo === 12;
  const submit = () => {
    const value = notSure || !month ? null : month;
    useOnboarding.getState().update({ examMonth: value });
    void answer(s, "exam_date", value);
    advance("exam-date");
  };
  return (
    <StepFrame
      testID="onb-06"
      onBack={back}
      progress={progress}
      title={t(board && !exam ? "onboarding:ONB-06.headline_board" : "onboarding:ONB-06.headline")}
      pet={month || notSure ? { ...pet, text: t(notSure ? "onboarding:ONB-06.pet_reaction_not_sure" : "onboarding:ONB-06.pet_reaction") } : undefined}
      primary={{ label: t("onboarding:ONB-06.primary"), onPress: submit, disabled: !month && !notSure, testID: "exam-date-continue" }}
    >
      {exam && profile && <Chip kind="status" tone="primary" label={t("onboarding:ONB-06.cycle_chip", { exam_short: exam.name[locale], cycle: profile.cycle })} className="self-start" />}
      <TextField
        label={t("onboarding:ONB-06.add_month")}
        type="month"
        min={thisMonth}
        value={month}
        onChange={(e) => {
          setMonth(e.target.value);
          setNotSure(false);
        }}
        helper={t("onboarding:ONB-06.month_only_caption")}
        testID="exam-month"
      />
      <ChoiceChips label={t("onboarding:ONB-06.not_sure")} hideLabel options={[{ value: "not_sure", label: t("onboarding:ONB-06.not_sure") }]} value={notSure ? ["not_sure"] : []} onChange={(v) => setNotSure(v.length > 0)} testID="exam-not-sure" />
      {d.goals.filter((g) => g !== "curious").length > 1 && <Text tone="muted">{t("onboarding:ONB-06.multi_goal_note")}</Text>}
    </StepFrame>
  );
}

/** ONB-07: where are you now? Starts the first lesson further in for basics and revising. */
function LevelStep({ s, back, advance, progress }: StepProps) {
  const { t, locale } = useI18n();
  const d = useOnboarding();
  const exams = useExams();
  const pet = usePet();
  const [level, setLevel] = useState<Level | null>(d.level);
  const main = d.goals.find((g) => g !== "curious" && !isSchoolProfile(g));
  const exam = (exams.data ?? []).find((e) => e.profiles.some((p) => p.id === main));
  const school = !exam && d.classNo !== null;
  const opts: { v: Level; n: 1 | 2 | 3; art: string }[] = [
    { v: "starting", n: 1, art: "level-pencil" },
    { v: "basics", n: 2, art: "level-notebook" },
    { v: "revising", n: 3, art: "level-highlighter" },
  ];
  const submit = () => {
    if (!level) return;
    useOnboarding.getState().update({ level });
    void answer(s, "level", level);
    advance("level");
  };
  return (
    <StepFrame
      testID="onb-07"
      onBack={back}
      progress={progress}
      title={school ? t("onboarding:ONB-07.headline_school", { n: d.classNo ?? "" }) : t("onboarding:ONB-07.headline", { exam_short: exam?.name[locale] ?? "" })}
      pet={level ? { ...pet, text: t(`onboarding:ONB-07.reaction_${level}`) } : undefined}
      primary={{ label: t("onboarding:ONB-07.primary"), onPress: submit, disabled: !level, testID: "level-continue" }}
    >
      <div role="radiogroup" aria-label={t("onboarding:ONB-07.headline", { exam_short: exam?.name[locale] ?? "" })} className="flex flex-col gap-3">
        {opts.map((o) => (
          <OptionCard
            key={o.v}
            kind="choice"
            label={t(school ? `onboarding:ONB-07.school_card_${o.n}` : `onboarding:ONB-07.card_${o.n}`)}
            description={school ? undefined : t(`onboarding:ONB-07.card_${o.n}_caption`)}
            illustration={o.art}
            state={level === o.v ? "selected" : "idle"}
            onPress={() => setLevel(o.v)}
            testID={`level-${o.v}`}
          />
        ))}
      </div>
    </StepFrame>
  );
}

const NAME_MAX = 12;

/** ONB-10: pick a study buddy and name it (1 to 12 letters). */
function BuddyStep({ s, back, advance, progress }: StepProps) {
  const { t } = useI18n();
  const d = useOnboarding();
  const [species, setSpecies] = useState<"cat" | "dog" | null>(d.petSpecies);
  const [name, setName] = useState(d.petName ?? "");
  const [touched, setTouched] = useState(false);
  const [usedSuggestion, setUsedSuggestion] = useState(false);
  const trimmed = name.trim();
  const error = !touched ? null : !trimmed ? t("onboarding:ONB-10.error_empty") : [...trimmed].length > NAME_MAX ? t("onboarding:ONB-10.error_too_long") : null;
  const valid = !!species && !!trimmed && [...trimmed].length <= NAME_MAX;
  const submit = async () => {
    setTouched(true);
    if (!valid || !species) return;
    useOnboarding.getState().update({ petSpecies: species, petName: trimmed });
    await namePet(s, species, trimmed);
    s.analytics.track("pet_named", { species, used_suggestion: usedSuggestion ? "yes" : "no" });
    advance("buddy");
  };
  return (
    <StepFrame
      testID="onb-10"
      onBack={back}
      progress={progress}
      title={t("onboarding:ONB-10.headline")}
      pet={species ? { species, name: trimmed || t(species === "cat" ? "onboarding:ONB-10.cat_card" : "onboarding:ONB-10.dog_card"), text: trimmed && !error ? t("onboarding:ONB-10.name_reaction", { pet_name: trimmed }) : t(species === "cat" ? "onboarding:ONB-10.cat_line" : "onboarding:ONB-10.dog_line") } : undefined}
      primary={{ label: t("onboarding:ONB-10.primary"), onPress: () => void submit(), disabled: !species, testID: "buddy-continue" }}
    >
      <div role="radiogroup" aria-label={t("onboarding:ONB-10.headline")} className="grid grid-cols-2 gap-3">
        <OptionCard kind="choice" label={t("onboarding:ONB-10.cat_card")} illustration="cat-wave" state={species === "cat" ? "selected" : "idle"} onPress={() => setSpecies("cat")} testID="buddy-cat" />
        <OptionCard kind="choice" label={t("onboarding:ONB-10.dog_card")} illustration="dog-wave" state={species === "dog" ? "selected" : "idle"} onPress={() => setSpecies("dog")} testID="buddy-dog" />
      </div>
      {species && (
        <>
          <TextField
            label={t("onboarding:ONB-10.name_label")}
            placeholder={t("onboarding:ONB-10.placeholder")}
            value={name}
            maxLength={24}
            autoComplete="off"
            onChange={(e) => {
              setName(e.target.value);
              setUsedSuggestion(false);
            }}
            onBlur={() => setTouched(true)}
            helper={t("onboarding:ONB-10.helper")}
            error={error}
            testID="pet-name"
          />
          <ChoiceChips
            label={t("onboarding:ONB-10.name_label")}
            hideLabel
            options={parts(t("onboarding:ONB-10.suggestions")).map((n) => ({ value: n, label: n }))}
            value={[trimmed]}
            onChange={(v) => {
              const pick = v[v.length - 1] ?? v[0];
              if (pick) {
                setName(pick);
                setUsedSuggestion(true);
              }
            }}
            testID="pet-suggestions"
          />
        </>
      )}
    </StepFrame>
  );
}

/** ONB-12: tap the pot to plant the seed, then the first lesson. */
function PlantStep({ s, back }: { s: Services; back: () => void }) {
  const { t } = useI18n();
  const d = useOnboarding();
  const navigate = useNavigate();
  const catalog = useCatalog();
  const [planted, setPlanted] = useState(d.seeded);
  const species = d.petSpecies ?? "cat";
  const first = catalog.subjects.flatMap((x) => x.chapters).find((c) => c.free)?.topics[0] ?? catalog.subjects[0]?.chapters[0]?.topics[0];
  const plant = async () => {
    if (planted) return;
    setPlanted(true);
    useOnboarding.getState().update({ seeded: true });
    await plantSeed(s);
  };
  return (
    <StepFrame
      testID="onb-12"
      onBack={back}
      title={planted ? t("onboarding:ONB-12.headline_after") : t("onboarding:ONB-12.instruction")}
      helper={planted ? t("onboarding:ONB-12.rule") : undefined}
      pet={planted ? { species, name: d.petName ?? "", text: first ? t("onboarding:ONB-12.pet_line_lesson", { minutes: first.minutes }) : t("onboarding:ONB-12.pet_line_direct_lane") } : undefined}
      primary={
        planted
          ? {
              label: t("onboarding:ONB-12.primary_lesson"),
              onPress: () => void navigate({ to: "/onboarding/first-lesson" }),
              testID: "start-first-lesson",
            }
          : { label: t("onboarding:ONB-12.fallback_primary_after_12_s"), onPress: () => void plant(), testID: "plant-fallback" }
      }
    >
      <button
        type="button"
        onClick={() => void plant()}
        aria-label={t("onboarding:ONB-12.instruction")}
        aria-pressed={planted}
        disabled={planted}
        data-testid="plant-pot"
        className="mx-auto mt-4 grid place-items-center rounded-card-large outline-none focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <PlantView stage={planted ? "seed" : "seed"} size={200} decorative />
      </button>
      {!planted && <Illustration name={species === "cat" ? "cat-watering" : "dog-wave"} width={96} height={96} decorative className="mx-auto" />}
    </StepFrame>
  );
}
