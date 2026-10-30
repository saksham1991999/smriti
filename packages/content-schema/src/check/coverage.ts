import { TEACHING_CARD_TYPES } from "../constants.js";
import type { Card, ConceptCoverage, CoverageReport, Requirement, Tally } from "../generated/types.js";
import type { Findings } from "./findings.js";
import type { ContentSet } from "./load.js";

function pct(covered: number, total: number): number {
  return total === 0 ? 100 : Math.round((covered / total) * 10000) / 100;
}

function tally(concepts: ConceptCoverage[]): Tally {
  const covered = concepts.filter((c) => c.covered).length;
  return { concepts: concepts.length, covered, percent: pct(covered, concepts.length) };
}

interface CardUse {
  card: Card;
  mode: "deep_dive" | "quick_revision";
}

/**
 * The coverage report for one exam profile (quality-bar 1.3, PRD 14). Every concept in the exam map
 * needs, at or below the exam's depth for it:
 * a teaching card in a Deep Dive, a card in Quick Revision, a practice question, a spaced-repetition
 * card (a summary card), and for formulas a formula card plus a worked example, for lists and dates
 * a memory hook in every locale of the profile.
 */
export function computeCoverage(set: ContentSet, profileId: string, findings: Findings): CoverageReport | null {
  const map = set.examMaps.find((m) => m.doc.exam_profile === profileId);
  const profile = set.profiles.get(profileId);
  if (!map || !profile) return null;
  const locales = profile.profile.locales;
  const released = new Set(map.doc.released_subjects ?? []);

  const cardsByConcept = new Map<string, CardUse[]>();
  for (const { doc } of set.lessons) {
    for (const card of doc.cards) {
      for (const c of card.concepts) {
        const list = cardsByConcept.get(c) ?? [];
        list.push({ card, mode: doc.mode });
        cardsByConcept.set(c, list);
      }
    }
  }
  const questionsByConcept = new Map<string, { depth: number; use: string[] }[]>();
  for (const { question } of set.questions.values()) {
    for (const c of question.concepts) {
      const list = questionsByConcept.get(c.id) ?? [];
      list.push({ depth: question.depth, use: question.use });
      questionsByConcept.set(c.id, list);
    }
  }
  const hookLocales = new Map<string, Set<string>>();
  for (const { mnemonic } of set.mnemonics.values()) {
    const s = hookLocales.get(mnemonic.concept) ?? new Set<string>();
    s.add(mnemonic.locale);
    hookLocales.set(mnemonic.concept, s);
  }

  type Row = { subject: string; chapter: string; chapterSort: number; coverage: ConceptCoverage };
  const rows: Row[] = [];
  for (const entry of map.doc.concepts) {
    const id = set.aliases.get(entry.id) ?? entry.id;
    const concept = set.concepts.get(id);
    if (!concept) continue; // reported by the rules
    const depth = entry.depth;
    const cards = (cardsByConcept.get(id) ?? []).filter((u) => u.card.depth <= depth);
    const dd = cards.filter((u) => u.mode === "deep_dive");
    const qr = cards.filter((u) => u.mode === "quick_revision");
    const required: Requirement[] = ["teaching_card", "revision_card", "practice_question", "srs_card"];
    const met = new Set<Requirement>();
    if (dd.some((u) => TEACHING_CARD_TYPES.includes(u.card.type))) met.add("teaching_card");
    if (qr.length > 0) met.add("revision_card");
    if ((questionsByConcept.get(id) ?? []).some((q) => q.use.includes("practice") && q.depth <= depth)) {
      met.add("practice_question");
    }
    if (cards.some((u) => u.card.type === "summary")) met.add("srs_card");
    if (concept.concept.kind === "formula") {
      required.push("formula_card", "worked_example");
      if (dd.some((u) => u.card.type === "formula")) met.add("formula_card");
      if (dd.some((u) => u.card.type === "worked_example")) met.add("worked_example");
    }
    if (concept.concept.kind === "list" || concept.concept.kind === "date") {
      required.push("memory_hook");
      const have = hookLocales.get(id) ?? new Set<string>();
      if (locales.every((l) => have.has(l))) met.add("memory_hook");
    }
    const missing = required.filter((r) => !met.has(r));
    rows.push({
      subject: concept.chapter.subject,
      chapter: concept.chapter.id,
      chapterSort: set.subjects.find((s) => s.doc.id === concept.chapter.subject)?.doc.chapters.indexOf(concept.chapter.id) ?? 0,
      coverage: {
        id,
        kind: concept.concept.kind,
        depth,
        covered: missing.length === 0,
        met: required.filter((r) => met.has(r)),
        missing,
      },
    });
  }

  // Syllabus lines and inventory items.
  const syllabus = set.syllabi.find((s) => s.doc.exam_profile === profileId);
  const lines = syllabus?.doc.lines ?? [];
  const unmappedLines = lines.filter((l) => l.concepts.length === 0 || l.concepts.some((c) => !set.concepts.has(set.aliases.get(c) ?? c)));
  const subjects = [...new Set(rows.map((r) => r.subject))].sort((a, b) => {
    const sa = set.subjects.find((s) => s.doc.id === a)?.doc.sort ?? 0;
    const sb = set.subjects.find((s) => s.doc.id === b)?.doc.sort ?? 0;
    return sa - sb || a.localeCompare(b);
  });
  for (const s of released) if (!subjects.includes(s)) subjects.push(s);
  const profileChapters = new Set(rows.map((r) => r.chapter));
  // Chapter inventories only; a subject's excluded-chapters file has no items.
  const inventoryItems = set.inventories.flatMap((i) => {
    const chapter = i.doc.chapter;
    if (!chapter || !profileChapters.has(chapter)) return [];
    return (i.doc.items ?? []).map((item) => ({ chapter, item }));
  });
  const unmappedItems = inventoryItems.filter(({ item }) => item.concepts.length === 0 && !item.out_of_syllabus);
  const excluded = inventoryItems.filter(({ item }) => item.concepts.length === 0 && item.out_of_syllabus).length;

  const report: CoverageReport = {
    schema: "coverage@1",
    exam_profile: profileId,
    ...(set.isFixtureRoot ? { fixture: true } : {}),
    totals: tally(rows.map((r) => r.coverage)),
    syllabus: {
      lines: lines.length,
      mapped: lines.length - unmappedLines.length,
      percent: pct(lines.length - unmappedLines.length, lines.length),
      unmapped: unmappedLines.map((l) => l.ref),
    },
    inventory: {
      items: inventoryItems.length,
      mapped: inventoryItems.length - unmappedItems.length - excluded,
      excluded,
      percent: pct(inventoryItems.length - unmappedItems.length, inventoryItems.length),
      unmapped: unmappedItems.map(({ chapter, item }) => `${chapter}#${item.id}`),
    },
    subjects: subjects.map((subject) => {
      const subjectRows = rows.filter((r) => r.subject === subject);
      const chapters = [...new Set(subjectRows.map((r) => r.chapter))].sort(
        (a, b) =>
          (subjectRows.find((r) => r.chapter === a)?.chapterSort ?? 0) -
          (subjectRows.find((r) => r.chapter === b)?.chapterSort ?? 0),
      );
      const linesOk = !unmappedLines.some((l) => l.ref.split(":")[1] === subject);
      const subjectChapters = set.chapters.filter((c) => c.doc.subject === subject).map((c) => c.doc.id);
      const itemsOk = !unmappedItems.some((u) => subjectChapters.includes(u.chapter));
      const concepts = subjectRows.map((r) => r.coverage);
      const t = tally(concepts);
      return {
        id: subject,
        released: released.has(subject),
        ready: concepts.length > 0 && t.covered === t.concepts && linesOk && itemsOk,
        tally: t,
        chapters: chapters.map((chapter) => {
          const cs = subjectRows.filter((r) => r.chapter === chapter).map((r) => r.coverage);
          return { id: chapter, tally: tally(cs), concepts: cs };
        }),
      };
    }),
  };

  const file = map.file;
  for (const subject of report.subjects) {
    const gaps = subject.chapters.flatMap((c) => c.concepts.filter((x) => !x.covered));
    const summary = gaps
      .slice(0, 5)
      .map((g) => `${g.id} (${g.missing.join(", ")})`)
      .join("; ");
    const message = `${profileId} ${subject.id}: coverage ${subject.tally.percent}%${gaps.length ? `; missing ${summary}${gaps.length > 5 ? ` and ${gaps.length - 5} more` : ""}` : ""}`;
    if (!subject.ready) {
      if (subject.released) findings.error("coverage_incomplete", file, `${message}. A released subject must be at 100%.`);
      else findings.warn("coverage_incomplete", file, message);
    }
    if (subject.released && !syllabus) {
      findings.error("syllabus_missing", file, `${profileId} has no coverage/syllabus/${profileId}.json, so coverage of ${subject.id} cannot be proved`);
    }
    if (subject.released) {
      for (const ch of set.chapters.filter((c) => c.doc.subject === subject.id)) {
        if (!set.inventories.some((i) => i.doc.chapter === ch.doc.id)) {
          findings.error("inventory_missing", file, `chapter ${ch.doc.id} of released subject ${subject.id} has no inventory`);
        }
      }
    }
  }
  if (unmappedLines.length) {
    findings.warn("syllabus_unmapped", syllabus?.file ?? file, `${unmappedLines.length} syllabus line(s) map to no concept: ${unmappedLines.map((l) => l.ref).join(", ")}`);
  }
  if (unmappedItems.length) {
    findings.warn("inventory_unmapped", file, `${unmappedItems.length} inventory item(s) map to no concept and have no exclusion reason`);
  }
  return report;
}
