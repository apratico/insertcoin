import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "public");

const bg = "#0b0f14";
const accent = "#f6c24c";

function coinSvg(size, opts = {}) {
  const { maskable = false } = opts;
  const pad = maskable ? Math.round(size * 0.18) : Math.round(size * 0.06);
  const safe = size - pad * 2;
  const cx = size / 2;
  const cy = size / 2;
  const radius = Math.round(safe * 0.38);
  const strokeW = Math.round(safe * 0.09);
  const slotW = Math.round(safe * 0.13);
  const slotH = Math.round(safe * 0.58);
  const slotX = cx - slotW / 2;
  const slotY = cy - slotH / 2;
  const bgCorner = maskable ? 0 : Math.round(size * 0.22);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
    <defs>
      <radialGradient id="g" cx="50%" cy="45%" r="60%">
        <stop offset="0%" stop-color="#1b2330"/>
        <stop offset="100%" stop-color="${bg}"/>
      </radialGradient>
      <filter id="glow">
        <feGaussianBlur stdDeviation="${Math.max(2, Math.round(size * 0.015))}" result="b"/>
        <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <rect width="${size}" height="${size}" rx="${bgCorner}" fill="url(#g)"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="${accent}" stroke-width="${strokeW}" filter="url(#glow)"/>
    <rect x="${slotX}" y="${slotY}" width="${slotW}" height="${slotH}" rx="${Math.round(slotW * 0.25)}" fill="${bg}"/>
    <circle cx="${cx}" cy="${cy}" r="${radius - strokeW - 2}" fill="none" stroke="${accent}" stroke-width="1" stroke-opacity="0.35"/>
  </svg>`;
}

async function renderPng(size, outName, opts) {
  const svg = coinSvg(size, opts);
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  const out = resolve(outDir, outName);
  await writeFile(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}

await renderPng(192, "icon-192.png", {});
await renderPng(512, "icon-512.png", {});
await renderPng(512, "icon-512-maskable.png", { maskable: true });
await renderPng(180, "apple-touch-icon.png", {});
