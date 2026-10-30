import { rupees, useI18n } from "./i18n";
import { useConfig } from "./queries";

/**
 * The web Pro prices from `GET /v1/config` `pricing` (tax-inclusive paise), formatted for the
 * locale. Null until the server has answered: screens show "Checking the price…" (PAY-01), never
 * a made-up number.
 */
export function usePrices(): { trial: string; monthly: string; trialPaise: number; monthlyPaise: number } | null {
  const { locale } = useI18n();
  const pricing = useConfig().data?.pricing ?? [];
  // Pro monthly on the web only; other plans (yearly, family) and rows without a price are skipped.
  const web = pricing.filter((p) => p.platform === "web" && p.period === "month" && p.entitlement === "pro" && typeof p.price_paise === "number");
  const monthly = web.find((p) => p.intro_price_paise === null || p.intro_price_paise === undefined) ?? web[0];
  const intro = web.find((p) => typeof p.intro_price_paise === "number");
  if (!monthly) return null;
  const trialPaise = intro?.intro_price_paise ?? monthly.price_paise;
  return { trial: rupees(trialPaise, locale), monthly: rupees(monthly.price_paise, locale), trialPaise, monthlyPaise: monthly.price_paise };
}
