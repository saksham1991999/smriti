export function robotsTxt(siteUrl: string, noindex: boolean): string {
  if (noindex) return "User-agent: *\nDisallow: /\n";
  return `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap-index.xml\n`;
}
