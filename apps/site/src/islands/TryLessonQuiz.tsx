// "Try a lesson" mini quiz island. Data comes from the content index (try_lesson), so the
// questions are never written here. Answers stay in this component's state: nothing is stored
// and only typed, text-free analytics events leave the page.

import { useId, useMemo, useRef, useState } from "react";
import { CheckCircleIcon as CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { XCircleIcon as XCircle } from "@phosphor-icons/react/dist/csr/XCircle";
import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowCounterClockwiseIcon as ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { InfoIcon as Info } from "@phosphor-icons/react/dist/csr/Info";
import { track } from "../lib/analytics";
import { scoreQuiz, type Confidence } from "./quiz-logic";
import "./quiz.css";

export interface QuizStrings {
  quizTitle: string;
  progress: string;
  confidence: string;
  sure: string;
  fifty: string;
  guess: string;
  check: string;
  next: string;
  finish: string;
  correct: string;
  wrong: string;
  answerIs: string;
  pickFirst: string;
  resultTitle: string;
  resultBody: string;
  continue: string;
  retry: string;
  petHint: string;
  petCorrect: string;
  petWrong: string;
  petDone: string;
  options: string;
  fixtureBadge: string;
}

export interface QuizQuestionView {
  id: string;
  stem: string;
  options: { id: string; text: string }[];
  answer: string;
  explanation: string;
}

export interface PetArt {
  src: string;
  alt: string;
  width: number;
  height: number;
}

export interface TryLessonQuizProps {
  lang: "en" | "hi";
  title: string;
  questions: QuizQuestionView[];
  strings: QuizStrings;
  continueHref: string;
  fixture: boolean;
  pet: { thinking: PetArt; celebrate: PetArt };
}

const fill = (t: string, vars: Record<string, string | number>) =>
  t.replace(/\{(\w+)\}/g, (w, k: string) => (k in vars ? String(vars[k]) : w));

export default function TryLessonQuiz(props: TryLessonQuizProps) {
  const { questions, strings: s } = props;
  const uid = useId();
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [confidence, setConfidence] = useState<Confidence>("none");
  const [checked, setChecked] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [nudge, setNudge] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const done = results.length === questions.length && checked === false && index >= questions.length;
  const q = questions[Math.min(index, questions.length - 1)]!;
  const isCorrect = checked && selected === q.answer;
  const letter = (id: string) => String.fromCharCode(65 + Math.max(0, q.options.findIndex((o) => o.id === id)));
  const score = useMemo(() => scoreQuiz(results), [results]);

  function check() {
    if (!selected) {
      setNudge(true);
      return;
    }
    const correct = selected === q.answer;
    setChecked(true);
    setResults((r) => [...r, correct]);
    track("site_quiz_answer", { position: index + 1, correct, confidence });
  }

  function next() {
    const last = index + 1 >= questions.length;
    setIndex((i) => i + 1);
    setSelected(null);
    setConfidence("none");
    setChecked(false);
    setNudge(false);
    if (last) {
      track("site_quiz_complete", { score: scoreQuiz(results).correct, total: questions.length });
    }
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function retry() {
    setIndex(0);
    setSelected(null);
    setConfidence("none");
    setChecked(false);
    setResults([]);
    setNudge(false);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  const pet = done ? props.pet.celebrate : props.pet.thinking;
  const petLine = done ? s.petDone : !checked ? s.petHint : isCorrect ? s.petCorrect : s.petWrong;

  return (
    <div className="quiz" data-testid="try-lesson-quiz">
      <div className="quiz-head">
        <div>
          <p className="quiz-kicker">{s.quizTitle}</p>
          <p className="quiz-title">{props.title}</p>
        </div>
        {props.fixture && (
          <span className="chip gold quiz-fixture">
            <Info size={16} weight="bold" aria-hidden="true" />
            {s.fixtureBadge}
          </span>
        )}
      </div>

      <div className="quiz-bar" aria-hidden="true">
        {questions.map((qq, i) => (
          <span
            key={qq.id}
            className={
              i < results.length ? (results[i] ? "seg ok" : "seg bad") : i === index && !done ? "seg now" : "seg"
            }
          />
        ))}
      </div>

      {!done ? (
        <form
          className="quiz-body"
          // method="dialog" outside a <dialog> never navigates, so a tap before hydration is harmless.
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (checked) next();
            else check();
          }}
        >
          <h3 className="quiz-progress" tabIndex={-1} ref={headingRef}>
            {fill(s.progress, { n: index + 1, total: questions.length })}
          </h3>
          <fieldset className="quiz-q">
            <legend className="quiz-stem">{q.stem}</legend>
            <div className="quiz-options" role="presentation">
              {q.options.map((o, i) => {
                const state = !checked
                  ? selected === o.id
                    ? "sel"
                    : ""
                  : o.id === q.answer
                    ? "ok"
                    : o.id === selected
                      ? "bad"
                      : "dim";
                const id = `${uid}-${q.id}-${o.id}`;
                return (
                  <label key={o.id} htmlFor={id} className={`opt ${state}`}>
                    <input
                      id={id}
                      type="radio"
                      name={`${uid}-${q.id}`}
                      value={o.id}
                      checked={selected === o.id}
                      disabled={checked}
                      onChange={() => {
                        setSelected(o.id);
                        setNudge(false);
                      }}
                    />
                    <span className="opt-key" aria-hidden="true">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="opt-text">{o.text}</span>
                    {state === "ok" && (
                      <span className="opt-icon" role="img" aria-label={s.correct}>
                        <CheckCircle size={24} weight="fill" aria-hidden="true" />
                      </span>
                    )}
                    {state === "bad" && (
                      <span className="opt-icon" role="img" aria-label={s.wrong}>
                        <XCircle size={24} weight="fill" aria-hidden="true" />
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {!checked && (
            <fieldset className="quiz-conf">
              <legend className="quiz-conf-label">{s.confidence}</legend>
              <div className="conf-row">
                {(["sure", "fifty", "guess"] as const).map((c) => (
                  <label key={c} className={confidence === c ? "conf on" : "conf"}>
                    <input
                      type="radio"
                      name={`${uid}-${q.id}-conf`}
                      value={c}
                      checked={confidence === c}
                      onChange={() => setConfidence(c)}
                    />
                    {c === "sure" ? s.sure : c === "fifty" ? s.fifty : s.guess}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="quiz-feedback" aria-live="polite">
            {checked && (
              <div className={isCorrect ? "fb ok" : "fb bad"}>
                <p className="fb-title">
                  {isCorrect ? (
                    <CheckCircle size={24} weight="fill" aria-hidden="true" />
                  ) : (
                    <XCircle size={24} weight="fill" aria-hidden="true" />
                  )}
                  {isCorrect ? s.correct : s.wrong}
                  {!isCorrect && <span className="fb-answer">{fill(s.answerIs, { option: letter(q.answer) })}</span>}
                </p>
                <p className="fb-body">{q.explanation}</p>
              </div>
            )}
            {nudge && !checked && <p className="fb-nudge">{s.pickFirst}</p>}
          </div>

          <div className="quiz-foot">
            <div className="pet-line">
              <img src={pet.src} alt="" width={pet.width} height={pet.height} loading="lazy" decoding="async" />
              <p className="bubble">{petLine}</p>
            </div>
            <button type="submit" className="btn">
              {!checked ? s.check : index + 1 >= questions.length ? s.finish : s.next}
              {checked && <ArrowRight size={20} weight="bold" aria-hidden="true" />}
            </button>
          </div>
        </form>
      ) : (
        <div className="quiz-body quiz-done">
          <img
            className="done-art"
            src={props.pet.celebrate.src}
            alt={props.pet.celebrate.alt}
            width={props.pet.celebrate.width}
            height={props.pet.celebrate.height}
            loading="lazy"
            decoding="async"
          />
          <h3 className="done-title" tabIndex={-1} ref={headingRef}>
            {fill(s.resultTitle, { score: score.correct, total: questions.length })}
          </h3>
          <p className="done-body">{s.resultBody}</p>
          <div className="done-ctas">
            <a className="btn" href={props.continueHref} data-cta="try_lesson" data-placement="quiz_end">
              {s.continue}
              <ArrowRight size={20} weight="bold" aria-hidden="true" />
            </a>
            <button type="button" className="btn secondary" onClick={retry}>
              <ArrowCounterClockwise size={20} weight="bold" aria-hidden="true" />
              {s.retry}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
