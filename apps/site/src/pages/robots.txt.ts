// robots.txt, built with the configured site URL. Preview builds (SITE_NOINDEX=1) block all.
import type { APIRoute } from "astro";
import { site } from "../config/site";
import { robotsTxt } from "../lib/robots";

export const GET: APIRoute = () =>
  new Response(robotsTxt(site.siteUrl, site.noindex), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
