# UI font: Inter (Latin subset)

`inter-latin.woff2` is the font the app UI itself renders in — the
`@font-face` in `src/styles/tokens.css` points at it. It is a **separate**
redistributed copy of Inter from a **different source** than the map's
glyph PBFs:

- Map glyphs (`web/public/map/fonts/`): rasterized here, straight from the
  static TTFs in the Inter v4.1 GitHub release zip.
- This file: Google Fonts' hosted webfont build of Inter, fetched by
  `web/scripts/fetch-ui-font.mjs` from `fonts.googleapis.com`'s CSS2 API
  (variable weight 100–900, the `latin` unicode-range subset only).

Same upstream project, same licence, but a different build pipeline and a
different regeneration command (`fetch:ui-font`, not `build:map-glyphs`) —
regenerating one does not regenerate or re-verify the other.

## Licence

Copyright (c) 2016 The Inter Project Authors (<https://github.com/rsms/inter>).
Licensed under the **SIL Open Font License, Version 1.1** (OFL), same as the
map glyphs. The full licence text is not duplicated in this folder because
this `README.md` isn't part of Vite's module graph (nothing `import`s it,
and only `web/public/` is copied to the build output verbatim) — it does not
reach `dist/`, and doesn't need to: the deployed site already carries the
full OFL text at `dist/map/fonts/OFL.txt` (source:
`web/public/map/fonts/OFL.txt`), satisfying OFL's copy-with-notice condition
for the whole deployed bundle, this file included. If `inter-latin.woff2`
ever moves somewhere it might ship independently of `map/fonts/`, copy the
licence text along with it at that point.

## Regenerate

```sh
npm run fetch:ui-font -w @triton/web
```
