# Flatten the chosen Agnes mark to the brand palette, then auto-trace it to a draft SVG.
import sys, re
import numpy as np
from PIL import Image, ImageFilter
import vtracer

src, out_png, out_svg = sys.argv[1:4]
PALETTE = {  # Agnes colour -> brand colour
    "white": ((255, 255, 255), (255, 255, 255)),
    "spark": ((0xF9, 0xAD, 0x25), (0xF5, 0xA3, 0x00)),   # tokens streak
    "leafDeep": ((0x2C, 0x5C, 0xC6), (0x35, 0x57, 0xE8)),  # tokens primary
    "stem": ((0x22, 0x82, 0xC5), (0x22, 0x82, 0xC5)),     # kept from Agnes
    "leafLight": ((0x31, 0x9E, 0xD3), (0x2B, 0xB5, 0xE8)), # tokens gem
}
im = Image.open(src).convert("RGB").filter(ImageFilter.MedianFilter(5))
a = np.asarray(im).astype(float)
srcs = np.array([v[0] for v in PALETTE.values()], float)
dsts = np.array([v[1] for v in PALETTE.values()], np.uint8)
d = ((a[:, :, None, :] - srcs[None, None]) ** 2).sum(-1)
lab = d.argmin(-1)
# a pixel only counts as colour when it is clearly not background
lab[a.min(-1) > 215] = 0
img = Image.fromarray(dsts[lab]).filter(ImageFilter.ModeFilter(7))
img.save(out_png)
vtracer.convert_image_to_svg_py(out_png, out_svg, colormode="color", hierarchical="stacked",
    mode="spline", filter_speckle=8, color_precision=6, layer_difference=24,
    corner_threshold=60, length_threshold=4.0, splice_threshold=45, path_precision=2)
s = open(out_svg).read()
# drop the white background shapes so the SVG is transparent
s = re.sub(r'<path[^>]*fill="#FFFFFF"[^>]*/>\s*', "", s, flags=re.I)
s = re.sub(r'<path[^>]*fill="#FEFEFE"[^>]*/>\s*', "", s, flags=re.I)
open(out_svg, "w").write(s)
fills = sorted(set(re.findall(r'fill="(#[0-9A-Fa-f]{6})"', s)))
print("paths", s.count("<path"), "fills", fills, "bytes", len(s))
