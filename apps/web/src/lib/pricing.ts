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
  const web = pricing.filter((p) => p.platform === "web");
  const monthly = web.find((p) => p.intro_price_paise === null || p.intro_price_paise === undefined) ?? web[0];
  const intro = web.find((p) => typeof p.intro_price_paise === "number");
  if (!monthly) return null;
  const trialPaise = intro?.intro_price_paise ?? monthly.price_paise;
  return { trial: rupees(trialPaise, locale), monthly: rupees(monthly.price_paise, locale), trialPaise, monthlyPaise: monthly.price_paise };
}

/**
 * `{ intro_price, price }` for catalogue strings that name a price (`{intro_price}`, `{price}`).
 * While the server hasn't answered, both read "…" so no string shows a made-up amount.
 */
export function usePriceValues(): { intro_price: string; price: string } {
  const prices = usePrices();
  return { intro_price: prices?.trial ?? "…", price: prices?.monthly ?? "…" };
}
