#!/usr/bin/env node
/**
 * Dev-time only, network-required: regenerates `web/src/assets/fonts/inter-latin.woff2`
 * (and the matching `inter-latin.range.txt`), the variable-weight Inter font
 * file the UI itself uses (see the `@font-face` in `src/styles/tokens.css`).
 * The planner never fetches this at runtime — the woff2 is bundled statically
 * and served from the page's own origin via a relative `src` url, same as the
 * map's glyph PBFs (`build-map-glyphs.mjs`) are bundled instead of fetched
 * live. Google Fonts' CSS2 endpoint subsets Inter into unicode-range slices;
 * we take only the block labelled "latin" — the Latin-1 + a handful of
 * general punctuation codepoints the UI's English copy actually needs. Requesting
 * with a Chrome User-Agent gets woff2 (Google serves woff/ttf to older UAs).
 *
 * Rerun (needs network) and commit if Inter's hosted build changes:
 *   npm run fetch:ui-font -w @triton/web
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CSS_URL = 'https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap';
const CHROME_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const cssRes = await fetch(CSS_URL, { headers: { 'User-Agent': CHROME_UA } });
if (!cssRes.ok) throw new Error(`HTTP ${cssRes.status} fetching ${CSS_URL}`);
const css = await cssRes.text();

// Each unicode-range slice is a separate @font-face block preceded by a
// `/* <name> */` comment; take the one labelled "latin".
const blocks = css.split(/(?=\/\*\s*[\w-]+\s*\*\/)/).filter((b) => b.trim());
const latinBlock = blocks.find((b) => /^\/\*\s*latin\s*\*\//.test(b.trim()));
if (!latinBlock) throw new Error('no /* latin */ block in the returned CSS — did Google change the format?');

const urlMatch = latinBlock.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/);
if (!urlMatch) throw new Error('no woff2 url in the latin block');
const woff2Url = urlMatch[1];

const rangeMatch = latinBlock.match(/unicode-range:\s*([^;]+);/);
if (!rangeMatch) throw new Error('no unicode-range in the latin block');
const unicodeRange = rangeMatch[1].trim();

console.log(`Fetching ${woff2Url} ...`);
const fontRes = await fetch(woff2Url);
if (!fontRes.ok) throw new Error(`HTTP ${fontRes.status} fetching ${woff2Url}`);
const fontBuf = new Uint8Array(await fontRes.arrayBuffer());

const dest = fileURLToPath(new URL('../src/assets/fonts/inter-latin.woff2', import.meta.url));
await writeFile(dest, fontBuf);
const rangeDest = fileURLToPath(new URL('../src/assets/fonts/inter-latin.range.txt', import.meta.url));
await writeFile(rangeDest, unicodeRange + '\n');

console.log(`Wrote ${fontBuf.length} bytes to ${dest}`);
console.log(`unicode-range: ${unicodeRange}`);
console.log(`\nMake sure the @font-face in src/styles/tokens.css uses this exact unicode-range.`);
