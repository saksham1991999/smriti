// Build the Smriti brand pack from the traced mark: SVG variants, PNGs, app icons, favicons, lockups.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [markPath, outDir] = process.argv.slice(2);
const INK = '#151A2D', MUTED = '#4A5470';
const ACCENT = { all: '#3557E8', jee: '#3557E8', neet: '#1F9D55', upsc: '#0E7C93', ssc: '#E8590C' };

let base = fs.readFileSync(markPath, 'utf8');
// drop tiny stray specks left by the tracer
base = base.replace(/  <path class="stem" d="([^"]+)"[^>]*\/>\n/g, (m, d) => {
  const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
  const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2 === 1);
  return (Math.max(...xs) - Math.min(...xs) < 60 && Math.max(...ys) - Math.min(...ys) < 60) ? '' : m;
});
const recolor = (svg, map) => svg.replace(/<path class="([^"]+)"([^>]*?) fill="#[0-9A-F]{6}"/g,
  (m, cls, mid) => !(cls in map) ? m : map[cls] === null ? m.replace(/<path/, '<path display="none"') :
    `<path class="${cls}"${mid} fill="${(map[cls] || {}).fill || map[cls]}"${(map[cls] || {}).opacity ? ` fill-opacity="${map[cls].opacity}"` : ''}`);
const stripHidden = svg => svg.replace(/  <path display="none"[^>]*\/>\n/g, '');

const V = {
  'smriti-mark.svg': base,
  'smriti-mark-white.svg': recolor(base, { 'leaf-deep': '#FFFFFF', 'leaf-light': { fill: '#FFFFFF', opacity: 0.78 }, stem: '#FFFFFF', spark: '#F5A300' }),
  'smriti-mark-all-white.svg': recolor(base, { 'leaf-deep': '#FFFFFF', 'leaf-light': { fill: '#FFFFFF', opacity: 0.78 }, stem: '#FFFFFF', spark: '#FFFFFF' }),
  'smriti-mark-mono-ink.svg': recolor(base, { 'leaf-deep': INK, 'leaf-light': INK, stem: INK, spark: INK }),
  'smriti-mark-mono-white.svg': recolor(base, { 'leaf-deep': '#FFFFFF', 'leaf-light': '#FFFFFF', stem: '#FFFFFF', spark: '#FFFFFF' }),
  'smriti-favicon.svg': stripHidden(recolor(base, { spark: null })),
};
for (const d of ['svg', 'png', 'app-icons', 'favicon', 'lockup']) fs.mkdirSync(path.join(outDir, d), { recursive: true });
for (const [f, s] of Object.entries(V)) fs.writeFileSync(path.join(outDir, 'svg', f), stripHidden(s));

// favicon: crop the viewBox to the leaves and stem only (rough bbox from the remaining paths)
(function cropFavicon() {
  const f = path.join(outDir, 'svg', 'smriti-favicon.svg');
  let s = fs.readFileSync(f, 'utf8');
  const xs = [], ys = [];
  for (const [, d, tx, ty] of s.matchAll(/d="([^"]+)"[^>]*transform="translate\(([-\d.]+),([-\d.]+)\)"/g)) {
    const n = d.match(/-?\d+(?:\.\d+)?/g).map(Number);
    n.forEach((v, i) => (i % 2 ? ys : xs).push(v + (i % 2 ? +ty : +tx)));
  }
  // control points overshoot a little; the render step trims to real pixels
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const side = Math.max(x1 - x0, y1 - y0) * 1.04, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  s = s.replace(/viewBox="[^"]+"/, `viewBox="${(cx - side / 2).toFixed(0)} ${(cy - side / 2).toFixed(0)} ${side.toFixed(0)} ${side.toFixed(0)}"`);
  fs.writeFileSync(f, s);
})();

const svgOf = f => fs.readFileSync(path.join(outDir, 'svg', f), 'utf8');
const sized = (svg, px) => svg.replace('<svg ', `<svg width="${px}" height="${px}" `);

(async () => {
  const b = await chromium.launch();
  const shot = async (html, w, h, out, transparent = true) => {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.setContent(`<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@800&family=Plus+Jakarta+Sans:wght@800&display=block"></head><body style="margin:0;background:transparent">${html}</body></html>`, { waitUntil: 'networkidle' });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: out, omitBackground: transparent, clip: { x: 0, y: 0, width: w, height: h } });
    await p.close();
  };
  // plain marks
  for (const px of [1024, 512, 256, 128]) {
    await shot(sized(svgOf('smriti-mark.svg'), px), px, px, path.join(outDir, 'png', `smriti-mark-${px}.png`));
  }
  await shot(sized(svgOf('smriti-mark-mono-ink.svg'), 1024), 1024, 1024, path.join(outDir, 'png', 'smriti-mark-mono-ink-1024.png'));
  await shot(sized(svgOf('smriti-mark-mono-white.svg'), 1024), 1024, 1024, path.join(outDir, 'png', 'smriti-mark-mono-white-1024.png'));

  // app icons: full-bleed square (the OS rounds the corners), mark at 62% of the tile
  const tile = (variant, px) => {
    const markFile = variant === 'ssc' ? 'smriti-mark-all-white.svg' : 'smriti-mark-white.svg';
    const m = Math.round(px * 0.62);
    return `<div style="width:${px}px;height:${px}px;background:${ACCENT[variant]};display:grid;place-items:center">${sized(svgOf(markFile), m)}</div>`;
  };
  for (const v of Object.keys(ACCENT)) await shot(tile(v, 1024), 1024, 1024, path.join(outDir, 'app-icons', `${v}-1024.png`), false);
  // Android adaptive icon foreground: 432 px canvas, mark inside the 66% safe zone
  for (const [name, file] of [['android-foreground', 'smriti-mark-white.svg'], ['android-foreground-ssc', 'smriti-mark-all-white.svg'], ['android-monochrome', 'smriti-mark-mono-white.svg']]) {
    await shot(`<div style="width:432px;height:432px;display:grid;place-items:center">${sized(svgOf(file), 250)}</div>`, 432, 432, path.join(outDir, 'app-icons', `${name}-432.png`));
  }
  // favicons and touch icon
  for (const px of [16, 32, 48, 192, 512]) await shot(sized(svgOf('smriti-favicon.svg'), px), px, px, path.join(outDir, 'favicon', `favicon-${px}.png`));
  await shot(tile('all', 180), 180, 180, path.join(outDir, 'favicon', 'apple-touch-icon-180.png'), false);

  // lockups: mark + wordmark, light and dark
  const lock = (ink, sub, ground, markFile) => `<div style="width:1600px;height:480px;background:${ground};display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box">
    ${sized(svgOf(markFile), 300)}
    <div style="display:flex;align-items:baseline;gap:36px">
      <span style="font-family:'Plus Jakarta Sans';font-weight:800;font-size:176px;letter-spacing:-2px;color:${ink}">Smriti</span>
      <span lang="hi" style="font-family:'Noto Sans Devanagari';font-weight:800;font-size:132px;color:${sub}">स्मृति</span>
    </div></div>`;
  await shot(lock(INK, MUTED, 'transparent', 'smriti-mark.svg'), 1600, 480, path.join(outDir, 'lockup', 'smriti-lockup-light.png'));
  await shot(lock('#F3F4FA', '#A3A8BF', 'transparent', 'smriti-mark.svg'), 1600, 480, path.join(outDir, 'lockup', 'smriti-lockup-dark.png'));
  await shot(lock('#FFFFFF', '#FFFFFF', 'transparent', 'smriti-mark-mono-white.svg'), 1600, 480, path.join(outDir, 'lockup', 'smriti-lockup-mono-white.png'));
  await b.close();
  console.log('done');
})();
