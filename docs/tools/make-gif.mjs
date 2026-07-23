/** Assemble the section-switch demo GIF from three downscaled frames. */
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frames = [
  { file: 'gif-f1-conflict-small.png', delay: 2000 },
  { file: 'gif-f2-options-small.png', delay: 2000 },
  { file: 'gif-f3-resolved-small.png', delay: 3200 },
];

const gif = GIFEncoder();
let size = null;
for (const { file, delay } of frames) {
  const png = PNG.sync.read(readFileSync(join(here, file)));
  if (!size) size = { w: png.width, h: png.height };
  const rgba = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
  const palette = quantize(rgba, 256);
  const index = applyPalette(rgba, palette);
  gif.writeFrame(index, size.w, size.h, { palette, delay });
}
gif.finish();
const out = join(here, 'section-switch.gif');
writeFileSync(out, gif.bytes());
console.log(`wrote ${out} (${size.w}x${size.h}, ${(gif.bytes().length / 1024).toFixed(0)} KB)`);
