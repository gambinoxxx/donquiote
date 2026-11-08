// Generates the app icons in public/ from the Donquixote mark (lance and
// ring on an amber rounded square, components/brand/mark.tsx). Run once
// after changing the mark: `node scripts/icons/generate.mjs`.
// Colours are the ui-context.md tokens --accent-primary and --accent-on.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const AMBER = "#F5B544";
const INK = "#1A1406";
const OUT = fileURLToPath(new URL("../../public/", import.meta.url));

/** The mark's glyph (viewBox 0 0 100 100), as in components/brand/mark.tsx. */
const glyph = (color) => `
  <circle cx="46" cy="56" r="22" fill="none" stroke="${color}" stroke-width="7"/>
  <line x1="14" y1="88" x2="74" y2="28" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
  <polygon points="88,14 68,24 78,34" fill="${color}"/>`;

/**
 * size: output px; glyphShare: glyph size as a share of the icon;
 * radius: corner radius share (0 = full square, for maskable / Apple).
 */
function iconSvg({ size, glyphShare, radius, background = AMBER, color = INK }) {
  const g = size * glyphShare;
  const off = (size - g) / 2;
  const bg = background ? `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bg}
  <g transform="translate(${off} ${off}) scale(${g / 100})">${glyph(color)}</g>
</svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

/** A one-image .ico that wraps a PNG (supported by every current browser). */
function icoFromPng(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0);
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

const any = (size) => iconSvg({ size, glyphShare: 0.77, radius: 0.25 });
// Maskable: full-bleed amber, glyph inside the 80% safe circle.
const maskable = (size) => iconSvg({ size, glyphShare: 0.56, radius: 0 });
// Apple rounds the corners itself.
const apple = (size) => iconSvg({ size, glyphShare: 0.7, radius: 0 });
// Notification badge: Android uses only the alpha channel (monochrome).
const badge = (size) => iconSvg({ size, glyphShare: 0.9, radius: 0, background: null, color: "#FFFFFF" });

const files = {
  "icon-192.png": await png(any(192)),
  "icon-512.png": await png(any(512)),
  "icon-maskable-512.png": await png(maskable(512)),
  "apple-touch-icon.png": await png(apple(180)),
  "badge-96.png": await png(badge(96)),
  "favicon.svg": Buffer.from(any(64)),
  "favicon.ico": icoFromPng(await png(any(32)), 32),
};
for (const [name, buf] of Object.entries(files)) {
  await writeFile(OUT + name, buf);
  console.log(`public/${name} ${buf.length} bytes`);
}
