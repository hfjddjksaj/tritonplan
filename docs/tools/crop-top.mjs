import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [src, dst, hStr] = process.argv.slice(2);
const png = PNG.sync.read(readFileSync(src));
const h = Math.min(Number(hStr), png.height);
const out = new PNG({ width: png.width, height: h });
png.data.copy(out.data, 0, 0, png.width * h * 4);
writeFileSync(dst, PNG.sync.write(out));
console.log(`${dst}: ${png.width}x${h}`);
