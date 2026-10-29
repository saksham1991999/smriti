// Shared data for the exam → subject → chapter → topic templates: breadcrumbs (visible and
// JSON-LD), titles and descriptions, all from the content index and the catalogues.
import { site, type Locale } from "../config/site";
import { paths, type Chapter, type Exam, type Subject, type Topic } from "../content-index";
import { fmt, list, messages } from "../i18n";
import { breadcrumbs, type JsonLd } from "./seo";
import { absolute, localePath } from "./urls";

export interface Crumbs {
  visible: { name: string; href: string }[];
  jsonLd: JsonLd;
}

export function crumbsFor(lang: Locale, exam?: Exam, subject?: Subject, chapter?: Chapter, topic?: Topic): Crumbs {
  const m = messages(lang);
  const items: { name: string; path: string }[] = [
    { name: m.nav.home, path: "/" },
    { name: m.nav.exams, path: paths.exams() },
  ];
  if (exam) items.push({ name: exam.short_name[lang], path: paths.exam(exam) });
  if (exam && subject) items.push({ name: subject.name[lang], path: paths.subject(exam, subject) });
  if (exam && subject && chapter) items.push({ name: chapter.name[lang], path: paths.chapter(exam, subject, chapter) });
  if (exam && subject && chapter && topic) items.push({ name: topic.name[lang], path: paths.topic(exam, subject, chapter, topic) });
  return {
    visible: items.map((i) => ({ name: i.name, href: localePath(lang, i.path) })),
    jsonLd: breadcrumbs(items.map((i) => ({ name: i.name, url: absolute(site.siteUrl, localePath(lang, i.path)) }))),
  };
}

export function subjectList(lang: Locale, names: string[]): string {
  return list(lang, names);
}

export function brandName(lang: Locale): string {
  return site.brand.name[lang];
}

export function title(template: string, vars: Record<string, string | number>): string {
  return fmt(template, vars);
}
