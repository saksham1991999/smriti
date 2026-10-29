# Smriti logo

The mark is **Sprout and spark**, chosen by the owner on 2026-10-29 from the first Agnes round. Usage rules are in `DESIGN.md` §12, and the colours are `logo` in `packages/tokens/tokens.json`.

## Status

`svg/smriti-mark.svg` is an automatic trace of the Agnes image, cleaned of specks but not yet refined by hand. It is good enough for development builds and the design gallery. Before store submission a designer smooths its curves and runs the build again (below).

## Files

| Folder | What | Use |
|---|---|---|
| `source/` | The original Agnes image and its prompt and metadata | The source of everything else. Never edit it. |
| `svg/` | `smriti-mark` (full colour), `-white` (white with a gold spark), `-all-white` (for SSC orange), `-mono-ink`, `-mono-white`, and `smriti-favicon` (no rays) | Web, the site, print, and any new export |
| `png/` | The full-colour mark at 128–1024 px and the one-colour marks at 1024 px | Places that can't take SVG |
| `app-icons/` | `{all,jee,neet,upsc,ssc}-1024.png` full-bleed squares, and the Android adaptive foregrounds (432 px, mark inside the safe zone) plus the monochrome layer | `apps/mobile` per variant (the adaptive background colour is `examAccent.<variant>.light`) |
| `favicon/` | `favicon.ico` (16, 32 and 48 px), PNGs at 16–512 px, `apple-touch-icon-180.png` | `apps/web`, `apps/site`, the PWA manifest |
| `lockup/` | Mark and wordmark in English and Hindi: light, dark and one-colour white | Store listings, the site header, decks |

## Rebuilding

After the SVG is refined, from the repo root:

```bash
node tools/brand/build_pack.js brand/logo/svg/smriti-mark.svg brand/logo
```

It rewrites every SVG variant, PNG, app icon, favicon and lockup from the one master SVG. It needs Playwright with Chromium, and network access to Google Fonts for the lockups. `favicon.ico` is made from the favicon PNGs with Pillow (see `tools/brand/README.md`).

## Licence

The Agnes image was generated for this project (`licence: owned`, `source: agnes`). The trace was made with VTracer (MIT). The wordmark uses Plus Jakarta Sans and Noto Sans Devanagari, both under the SIL Open Font License.
