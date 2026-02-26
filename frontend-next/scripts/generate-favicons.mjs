/**
 * Generate all favicon variants from the source SVG.
 * Run: node scripts/generate-favicons.mjs
 *
 * Produces:
 *   src/app/icon.svg          — SVG (auto-served by Next.js)
 *   src/app/favicon.ico        — ICO (16+32+48, auto-served)
 *   src/app/apple-icon.png     — 180x180 Apple Touch Icon
 *   public/icon-192.png        — PWA manifest 192
 *   public/icon-512.png        — PWA manifest 512
 */

import sharp from "sharp";
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SVG_PATH = join(ROOT, "public", "favicon.svg");
const svgBuffer = readFileSync(SVG_PATH);

// Ensure directories exist
mkdirSync(join(ROOT, "src", "app"), { recursive: true });

const sizes = [
  { size: 16, name: "favicon-16.png" },
  { size: 32, name: "favicon-32.png" },
  { size: 48, name: "favicon-48.png" },
  { size: 180, name: "apple-icon.png", dest: "src/app" },
  { size: 192, name: "icon-192.png", dest: "public" },
  { size: 512, name: "icon-512.png", dest: "public" },
];

console.log("Generating favicon variants from SVG...\n");

// Generate PNGs
const pngBuffers = {};
for (const { size, name, dest } of sizes) {
  const buf = await sharp(svgBuffer).resize(size, size).png().toBuffer();
  pngBuffers[size] = buf;
  const outDir = dest ? join(ROOT, dest) : join(ROOT, "public");
  const outPath = join(outDir, name);
  writeFileSync(outPath, buf);
  console.log(`  ✓ ${name} (${size}x${size}) → ${dest || "public"}/`);
}

// Copy apple-icon
console.log(`  ✓ apple-icon.png (180x180) → src/app/`);

// Copy SVG to src/app/icon.svg (Next.js auto-serves it)
copyFileSync(SVG_PATH, join(ROOT, "src", "app", "icon.svg"));
console.log(`  ✓ icon.svg → src/app/`);

// Generate ICO (16 + 32 + 48 combined)
// ICO format: header + directory entries + PNG data
function createIco(pngMap) {
  const entries = [16, 32, 48];
  const pngs = entries.map((s) => pngMap[s]);

  // ICO header: 6 bytes
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = dirEntrySize * entries.length;
  let dataOffset = headerSize + dirSize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: ICO
  header.writeUInt16LE(entries.length, 4); // Count

  const dirEntries = [];
  const dataChunks = [];

  for (let i = 0; i < entries.length; i++) {
    const size = entries[i];
    const png = pngs[i];
    const entry = Buffer.alloc(dirEntrySize);

    entry.writeUInt8(size < 256 ? size : 0, 0); // Width
    entry.writeUInt8(size < 256 ? size : 0, 1); // Height
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(png.length, 8); // Data size
    entry.writeUInt32LE(dataOffset, 12); // Data offset

    dirEntries.push(entry);
    dataChunks.push(png);
    dataOffset += png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...dataChunks]);
}

const icoBuffer = createIco(pngBuffers);
writeFileSync(join(ROOT, "src", "app", "favicon.ico"), icoBuffer);
console.log(`  ✓ favicon.ico (16+32+48) → src/app/`);

// Clean up intermediate PNGs (keep only the final outputs)
const { unlinkSync } = await import("fs");
for (const name of ["favicon-16.png", "favicon-32.png", "favicon-48.png"]) {
  try {
    unlinkSync(join(ROOT, "public", name));
  } catch {}
}

console.log("\nDone! Files ready for Next.js auto-detection.");
