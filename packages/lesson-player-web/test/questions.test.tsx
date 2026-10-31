import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UIProvider } from "@smriti/ui-web";
import type { AnyQuestion } from "@smriti/lesson-core";
import { PlayerProvider, QuestionView, initialDraft, withAnswerKey } from "../src";
import { bundle, tEn } from "./bundles";

/** Every question in the fixture practice bundles, as a running mock serves it: no answer key. */
function keyless() {
  const out: { b: ReturnType<typeof bundle>["bundle"]; q: AnyQuestion }[] = [];
  for (const topic of ["topic-a", "topic-b", "topic-c", "topic-d"]) {
    const { bundle: b } = bundle(topic, "practice");
    for (const q of Object.values(b.questions) as AnyQuestion[]) {
      const list = q.type === "paragraph" ? ((q as { children?: AnyQuestion[] }).children ?? []) : [q];
      for (const one of list) {
        const { answer: _answer, ...rest } = one as AnyQuestion & { answer?: unknown };
        out.push({ b, q: rest as unknown as AnyQuestion });
      }
    }
  }
  return out;
}

describe("QuestionView with reveal none and no answer key", () => {
  const all = keyless();

  it("covers every question type in the fixtures", () => {
    const types = new Set(all.map((x) => x.q.type));
    for (const type of ["mcq_single", "mcq_multi", "numerical", "integer", "order_steps", "match_list", "matrix_match", "fill_blank", "assertion_reason", "statement_based"]) {
      expect(types.has(type as AnyQuestion["type"])).toBe(true);
    }
  });

  it.each(all.map((x) => [x.q.type, x.q.id, x] as const))("renders %s %s without reading a key, and marks nothing", (_type, _id, { b, q }) => {
    const { unmount } = render(
      <UIProvider locale="en">
        <PlayerProvider value={{ t: tEn, bundle: b, contentBaseUrl: "/c/", online: true }}>
          <QuestionView q={q} passage={null} draft={initialDraft(q)} onDraft={() => undefined} locked={false} reveal="none" struck={[]} />
        </PlayerProvider>
      </UIProvider>,
    );
    expect(screen.queryByTestId("correct-answer")).toBeNull();
    unmount();
  });

  it("leaves a question that has its key alone", () => {
    const { bundle: b } = bundle("topic-a", "practice");
    const q = Object.values(b.questions)[0] as AnyQuestion;
    expect(withAnswerKey(q)).toBe(q);
  });
});
