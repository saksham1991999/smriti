/**
 * Prices in copy are placeholders (`{price}`, `{intro_price}`) filled from the server's paise
 * values (`/v1/config` pricing, `/v1/billing/intro-eligibility`), never typed into strings.
 * Indian grouping in both locales (₹1,299); paise only when there are any (₹99.50).
 */
export function formatRupees(paise: number): string {
  const rupees = Math.max(0, Math.round(paise)) / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

/** The `{price}` and `{intro_price}` values for the i18n catalogue. */
export function priceValues(pricing: { monthly_paise: number; intro_paise: number | null }): { price: string; intro_price: string } {
  return { price: formatRupees(pricing.monthly_paise), intro_price: formatRupees(pricing.intro_paise ?? pricing.monthly_paise) };
}
