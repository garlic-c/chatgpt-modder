import { readFile, writeFile } from 'node:fs/promises';
const base = new URL('../build/icons/', import.meta.url);
const files = [
  [16, 'Tibo.iconset/icon_16x16.png'],
  [24, 'windows/icon-24.png'],
  [32, 'Tibo.iconset/icon_32x32.png'],
  [48, 'windows/icon-48.png'],
  [64, 'Tibo.iconset/icon_32x32@2x.png'],
  [128, 'Tibo.iconset/icon_128x128.png'],
  [256, 'Tibo.iconset/icon_128x128@2x.png'],
];
const header = Buffer.alloc(6 + files.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(files.length, 4);
const payloads = [];
let offset = header.length;
for (const [i, [size, file]] of files.entries()) {
  const png = await readFile(new URL(file, base));
  if (png.readUInt32BE(16) !== size || png.readUInt32BE(20) !== size)
    throw Error(`Invalid icon dimensions: ${file}`);
  const entry = 6 + i * 16;
  header[entry] = header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  payloads.push(png);
  offset += png.length;
}
await writeFile(new URL('Tibo.ico', base), Buffer.concat([header, ...payloads]));
