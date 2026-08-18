# Map glyph fonts

SDF glyph PBFs MapLibre reads for the map's text layers (`glyphs:
'${assetBase}map/fonts/{fontstack}/{range}.pbf'` in `src/lib/map-style.ts`).
Bundled and committed — the planner never fetches these at runtime, same as
the campus GIS data in `src/data/`.

- `Inter-Regular/0-255.pbf`, `Inter-Regular/256-511.pbf`
- `Inter-SemiBold/0-255.pbf`, `Inter-SemiBold/256-511.pbf`

The folder names are the fontstack MapLibre requests — they must stay in
sync with `MAP_FONT_REGULAR`/`MAP_FONT_BOLD` in `src/lib/map-style.ts`. The
two ranges (0-255, 256-511 — Latin + Latin Extended-A/part of Extended-B)
are the only ones the style needs: every label on the map (UCSD building,
district and road names) is ASCII.

## Source

- Font: **Inter v4.1** — <https://github.com/rsms/inter/releases/tag/v4.1>
- Files used: `extras/ttf/Inter-Regular.ttf`, `extras/ttf/Inter-SemiBold.ttf`
- Licence: **SIL Open Font License 1.1** (OFL) — full text copied to
  `OFL.txt` in this folder, straight from the release zip's `LICENSE.txt`,
  as OFL requires any distributed copies to carry the licence.
- Generated: 2026-08-17

## Route used to generate the PBFs

The brief's default route — open <https://maplibre.org/font-maker/> in a
browser, drag in the two TTFs, download the zip — needs a UI click a script
can't perform. `node-fontnik` (the library font-maker/tippecanoe/etc use)
was tried first: it's a native addon that needs `cmake`/`ninja` to build,
neither of which is installed here (`npm install fontnik` fails at
`scripts/install-native.js` — `cmake: command not found`), and installing a
C++ toolchain just for this felt like the wrong yak to shave.

Instead: **`web/scripts/build-map-glyphs.mjs`**, a from-scratch JS
reimplementation of the same pipeline font-maker/fontnik run server-side:

1. Fetch the Inter v4.1 release zip from GitHub, unzip in memory (`fflate`,
   already a dependency) and pull out the two TTFs + the OFL licence text —
   no manual download step.
2. Parse each TTF with `opentype.js` and, for every codepoint in `0-255` and
   `256-511`, look up its glyph via the font's own cmap (skipping codepoints
   with no entry — same as FreeType's `FT_Get_Char_Index` returning 0).
3. Flatten each glyph's quadratic/cubic outline commands to line-segment
   rings (12/16 subdivisions), in the same y-up, unscaled-then-scaled-to-24px
   coordinate space FreeType uses when a face is set to a 24pt/72dpi char
   size (`24 / font.unitsPerEm`).
4. Rasterize a signed-distance field per glyph by brute-force nearest-segment
   search (buffer=3px, cutoff=0.25, radius=8px, output byte = `255 - clamp(0,
   255, signedDistance*256/8 + cutoff*256)`, bottom-to-top row order) — the
   exact algorithm and constants
   [`mapbox/sdf-glyph-foundry`'s `RenderSDF()`](https://github.com/mapbox/sdf-glyph-foundry/blob/master/include/mapbox/glyph_foundry_impl.hpp)
   uses (the C++ core `node-fontnik`/font-maker call via FreeType), read
   straight from its source to match font-maker's output byte-for-byte in
   intent even though the rendering path (opentype.js curve flattening
   instead of FreeType) differs.
5. Hand-encode the result as the `glyphs.proto` wire format mapbox-gl/
   maplibre-gl read (`fontstacks` → repeated `glyph {id, bitmap, width,
   height, left, top, advance}`), verified field-for-field against
   maplibre-gl-js's own reader
   ([`src/style/parse_glyph_pbf.ts`](https://github.com/maplibre/maplibre-gl-js/blob/main/src/style/parse_glyph_pbf.ts)),
   using the `pbf` package (already a transitive dependency of maplibre-gl,
   added directly since we import it).

This is "Route 2" from the task ruling — genuinely offline after the one-time
network fetch of the Inter zip, no browser automation.

### Verification

Decoded every generated PBF back with a throwaway script built on the same
`pbf` reader MapLibre uses and checked the output is real, not placeholder
bytes:

- `Inter-Regular/0-255.pbf`: 191 glyphs (188 with a bitmap), width 2–22px
  (avg 11.0), height 1–29px (avg 16.6), advance 6–24px (avg 13.7).
- `Inter-Regular/256-511.pbf`: 254 glyphs (254 with a bitmap), width 2–29px
  (avg 12.7), height 13–28px (avg 20.0), advance 6–32px (avg 15.1).
- `Inter-SemiBold/0-255.pbf`: 191 glyphs (188 with a bitmap), width 3–23px
  (avg 11.7), height 2–29px (avg 16.7), advance 6–24px (avg 14.1).
- `Inter-SemiBold/256-511.pbf`: 254 glyphs (254 with a bitmap), width 2–30px
  (avg 13.3), height 13–28px (avg 20.1), advance 6–33px (avg 15.6).
- ASCII-art-rendered a few decoded bitmaps (`A`, `W`, `Ł`, `Š`) back from
  their SDF bytes — they are unmistakably the right letterforms, with the
  expected inside→edge→outside SDF gradient (`#` deep in the ink, `+`/`.`
  near the edge, blank background).
- `space` (and other outline-less codepoints, e.g. Inter's own `.null` glyph
  at U+0000) come out as advance-only entries (`width=0, height=0`, no
  bitmap field) — matches how real fontnik output represents them, and
  keeps text shaping able to position what follows a space correctly.

## Regenerate

Needs network (fetches the Inter zip from GitHub). Rerun and commit the
folders under `web/public/map/fonts/` when Inter is upgraded:

```sh
npm run build:map-glyphs -w @triton/web
```
