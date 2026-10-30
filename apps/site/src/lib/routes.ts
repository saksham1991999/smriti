// getStaticPaths helpers: every page exists once per locale, English at the root and Hindi
// under /hi/ (TRD §4.1 hreflang pairs).
import { LOCALES, type Locale } from "../config/site";

export const localeParams = () =>
  LOCALES.map((lang) => ({ params: { lang: lang === "en" ? undefined : lang }, props: { lang } }));

export function withLocales<P extends Record<string, string>, X extends object>(
  items: { params: P; props: X }[],
): { params: P & { lang: string | undefined }; props: X & { lang: Locale } }[] {
  return LOCALES.flatMap((lang) =>
    items.map((i) => ({
      params: { ...i.params, lang: lang === "en" ? undefined : lang },
      props: { ...i.props, lang },
    })),
  );
}
