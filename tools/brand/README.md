# Brand tools

Scripts that turn the chosen Agnes logo image into the files in `brand/logo/`. They don't draw anything: every shape comes from the Agnes image.

| Script | Does |
|---|---|
| `trace_mark.py <agnes.png> <flat.png> <trace.svg>` | Snaps the Agnes image to the logo colours (`logo` in `tokens.json`) and traces it with VTracer (`pip install vtracer`, MIT) |
| `clean_svg.py <trace.svg> <smriti-mark.svg>` | Drops the white background, names each path by its role (`leaf-deep`, `leaf-light`, `stem`, `spark`) and crops the viewBox |
| `build_pack.js <smriti-mark.svg> <brand/logo>` | Makes every SVG variant, PNG, app icon, favicon and lockup from the master SVG (Playwright with Chromium) |

`favicon.ico` comes from the favicon PNGs:

```bash
python3 -c "from PIL import Image; d='brand/logo/favicon/'; ims=[Image.open(d+f'favicon-{s}.png') for s in (48,32,16)]; ims[0].save(d+'favicon.ico', sizes=[(16,16),(32,32),(48,48)], append_images=ims[1:])"
```

Only run `trace_mark.py` and `clean_svg.py` again for a new Agnes source image. Once a designer has refined `smriti-mark.svg`, run only `build_pack.js`.
