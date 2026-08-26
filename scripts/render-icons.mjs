// Rasterizes site/assets/hublot-mark-color.svg into favicon.ico + transparent
// PNG icons + a favicon.svg copy. Rerun after any change to that source SVG:
//   npm run icons
import sharp from 'sharp';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(here, '..', 'site', 'assets');
const sourceSvg = path.join(assetsDir, 'hublot-mark-color.svg');

const icoSizes = [16, 32, 48];
const pngOnlySizes = [180, 192, 512, 1024];

// Builds a modern .ico (PNG-in-ICO, supported since Windows Vista) from raw
// PNG buffers, so packaging the favicon needs no external tool (no ImageMagick,
// no Python/Pillow) beyond sharp, which the repo already depends on.
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  const imageData = [];
  let offset = 6 + frames.length * 16;

  for (const { size, buf } of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buf.length, 8);
    entry.writeUInt32LE(offset, 12);
    dirEntries.push(entry);
    imageData.push(buf);
    offset += buf.length;
  }

  return Buffer.concat([header, ...dirEntries, ...imageData]);
}

async function main() {
  const svg = readFileSync(sourceSvg);

  const icoFrames = [];
  for (const size of icoSizes) {
    const buf = await sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();
    icoFrames.push({ size, buf });
  }
  writeFileSync(path.join(assetsDir, 'favicon.ico'), buildIco(icoFrames));
  console.log('wrote favicon.ico');

  for (const size of pngOnlySizes) {
    await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(path.join(assetsDir, `icon-${size}.png`));
    console.log('wrote icon-%d.png', size);
  }

  copyFileSync(sourceSvg, path.join(assetsDir, 'favicon.svg'));
  console.log('wrote favicon.svg');
}

main();
