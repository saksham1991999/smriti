# Tidy the traced SVG: drop the background, snap fills to the brand palette, crop the viewBox.
import re, sys
src, out = sys.argv[1:3]
PAL = {"#F5A300": "spark", "#3557E8": "leaf-deep", "#2282C5": "stem", "#2BB5E8": "leaf-light"}
def hx(c): return tuple(int(c[i:i+2], 16) for i in (1, 3, 5))
def snap(c):
    if sum(hx(c)) > 740: return None
    return min(PAL, key=lambda p: sum((a-b)**2 for a, b in zip(hx(c), hx(p))))
s = open(src).read()
paths = re.findall(r'<path d="([^"]+)" fill="(#[0-9A-Fa-f]{6})" transform="translate\(([-\d.]+),([-\d.]+)\)"/>', s)
keep, xs, ys = [], [], []
for d, fill, tx, ty in paths:
    f = snap(fill.upper())
    if not f: continue
    tx, ty = float(tx), float(ty)
    nums = [float(n) for n in re.findall(r'-?\d+(?:\.\d+)?', d)]
    xs += [n + tx for n in nums[0::2]]; ys += [n + ty for n in nums[1::2]]
    keep.append(f'  <path class="{PAL[f]}" d="{d.strip()}" fill="{f}" transform="translate({tx:g},{ty:g})"/>')
x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
side = max(x1 - x0, y1 - y0) * 1.10
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
vb = f"{cx - side/2:.0f} {cy - side/2:.0f} {side:.0f} {side:.0f}"
svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s" role="img" aria-label="Smriti">\n'
       '  <!-- Draft: automatic trace of the Agnes AI mark (round 1, option C). A designer cleans this up before release. -->\n'
       '%s\n</svg>\n') % (vb, "\n".join(keep))
open(out, "w").write(svg)
print(len(keep), "paths, viewBox", vb, len(svg), "bytes")
