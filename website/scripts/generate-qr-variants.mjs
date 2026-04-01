import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import qrcode from "qr.js";

const TARGET_URL = "https://freed.wtf";
const LOGO_FONT_URL =
  "https://fonts.gstatic.com/s/spacegrotesk/v22/V8mQoQDjQSkFtoMM3T6r8E7mF71Q-gOoraIAEj4PVksj.ttf";
const OUTPUT_DIR = join(process.cwd(), "website", "public", "qr");
const MODULE_SIZE = 18;
const QUIET_ZONE = 4;
const ERROR_CORRECTION = qrcode.ErrorCorrectLevel.H;
const QR = qrcode(TARGET_URL, {
  typeNumber: -1,
  errorCorrectLevel: ERROR_CORRECTION,
});
const GRID_SIZE = QR.modules.length;
const PADDING = QUIET_ZONE * MODULE_SIZE;
const CANVAS_SIZE = GRID_SIZE * MODULE_SIZE + PADDING * 2;
const CENTER = Math.floor(GRID_SIZE / 2);
const LOGO_ZONE = {
  min: CENTER - 2,
  max: CENTER + 2,
};

const variants = [{ id: "classic-neon", mode: "square" }];

function rectElement(x, y, width, height, rx = 0, extra = "") {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rx}" ${extra}/>`;
}

function toPixel(cell) {
  return PADDING + cell * MODULE_SIZE;
}

function hash(x, y, seed = 0) {
  const value = Math.sin((x + 1) * 12.9898 + (y + 1) * 78.233 + seed * 37.719);
  return value - Math.floor(value);
}

function isFinderCell(x, y) {
  const topLeft = x <= 6 && y <= 6;
  const topRight = x >= GRID_SIZE - 7 && y <= 6;
  const bottomLeft = x <= 6 && y >= GRID_SIZE - 7;
  return topLeft || topRight || bottomLeft;
}

function isLogoZoneCell(x, y) {
  return (
    x >= LOGO_ZONE.min &&
    x <= LOGO_ZONE.max &&
    y >= LOGO_ZONE.min &&
    y <= LOGO_ZONE.max
  );
}

function hasCell(x, y) {
  return Boolean(QR.modules[y]?.[x]);
}

function standardModule(x, y, mode) {
  const px = toPixel(x);
  const py = toPixel(y);

  if (mode === "square") {
    return rectElement(px, py, MODULE_SIZE, MODULE_SIZE, 0, 'fill="#050814"');
  }

  if (mode === "soft") {
    return rectElement(px + 1, py + 1, MODULE_SIZE - 2, MODULE_SIZE - 2, 5, 'fill="#050814"');
  }

  if (mode === "orbital") {
    const horizontal = hasCell(x - 1, y) || hasCell(x + 1, y);
    const vertical = hasCell(x, y - 1) || hasCell(x, y + 1);
    const rx = horizontal && !vertical ? 8 : vertical && !horizontal ? 8 : 6;
    const inset = horizontal || vertical ? 1 : 2;
    return rectElement(
      px + inset,
      py + inset,
      MODULE_SIZE - inset * 2,
      MODULE_SIZE - inset * 2,
      rx,
      'fill="#050814"',
    );
  }

  if (mode === "melted") {
    const inset = 1.6 + hash(x, y, 4) * 1.2;
    const size = MODULE_SIZE - inset * 2;
    const top = py + inset;
    const left = px + inset;
    const right = left + size;
    const bottom = top + size;
    const bend = 2.2 + hash(x, y, 8) * 1.8;
    return `<path fill="#050814" d="M ${left + bend} ${top}
      C ${left + size * 0.72} ${top - 0.8}, ${right} ${top + 0.8}, ${right} ${top + bend}
      C ${right + 0.8} ${top + size * 0.72}, ${right - 0.8} ${bottom}, ${right - bend} ${bottom}
      C ${left + size * 0.34} ${bottom + 0.8}, ${left} ${bottom - 0.6}, ${left} ${bottom - bend}
      C ${left - 0.7} ${top + size * 0.28}, ${left + 0.8} ${top}, ${left + bend} ${top} Z" />`;
  }

  const shape = hash(x, y, 11);
  if (shape > 0.66) {
    return `<circle cx="${px + MODULE_SIZE / 2}" cy="${py + MODULE_SIZE / 2}" r="${
      MODULE_SIZE * 0.34
    }" fill="#050814" />`;
  }
  if (shape > 0.33) {
    const inset = 2.2;
    return `<path fill="#050814" d="M ${px + MODULE_SIZE / 2} ${py + inset}
      L ${px + MODULE_SIZE - inset} ${py + MODULE_SIZE / 2}
      L ${px + MODULE_SIZE / 2} ${py + MODULE_SIZE - inset}
      L ${px + inset} ${py + MODULE_SIZE / 2} Z" />`;
  }
  return rectElement(px + 1.2, py + 1.2, MODULE_SIZE - 2.4, MODULE_SIZE - 2.4, 6, 'fill="#050814"');
}

function finderGroup(originX, originY, mode) {
  const x = toPixel(originX);
  const y = toPixel(originY);

  if (mode === "rebel") {
    return `
      <g>
        ${rectElement(x, y, MODULE_SIZE * 7, MODULE_SIZE * 7, 18, 'fill="#050814"')}
        ${rectElement(
          x + MODULE_SIZE,
          y + MODULE_SIZE,
          MODULE_SIZE * 5,
          MODULE_SIZE * 5,
          12,
          'fill="#ffffff"',
        )}
        <path d="M ${x + MODULE_SIZE * 3.5} ${y + MODULE_SIZE * 1.7} L ${x + MODULE_SIZE * 5.3} ${y + MODULE_SIZE * 3.5} L ${x + MODULE_SIZE * 3.5} ${y + MODULE_SIZE * 5.3} L ${x + MODULE_SIZE * 1.7} ${y + MODULE_SIZE * 3.5} Z" fill="#050814" />
      </g>
    `;
  }

  const outerRx = mode === "soft" || mode === "orbital" ? 18 : 12;
  const middleRx = mode === "soft" || mode === "orbital" ? 14 : 9;
  const innerRx = mode === "melted" ? 16 : mode === "soft" ? 14 : 8;

  return `
    <g>
      ${rectElement(x, y, MODULE_SIZE * 7, MODULE_SIZE * 7, outerRx, 'fill="#050814"')}
      ${rectElement(
        x + MODULE_SIZE,
        y + MODULE_SIZE,
        MODULE_SIZE * 5,
        MODULE_SIZE * 5,
        middleRx,
        'fill="#ffffff"',
      )}
      ${rectElement(
        x + MODULE_SIZE * 2,
        y + MODULE_SIZE * 2,
        MODULE_SIZE * 3,
        MODULE_SIZE * 3,
        innerRx,
        'fill="#050814"',
      )}
    </g>
  `;
}

function centerBadge(mode, embeddedFontCss) {
  const zoneX = toPixel(LOGO_ZONE.min);
  const zoneY = toPixel(LOGO_ZONE.min);
  const zoneSize = (LOGO_ZONE.max - LOGO_ZONE.min + 1) * MODULE_SIZE;
  const fontSize = 78;

  return `
    <g>
      <style><![CDATA[
        ${embeddedFontCss}
        .freed-logo-f {
          font-family: 'Space Grotesk Embedded', 'Space Grotesk', sans-serif;
          font-weight: 700;
        }
      ]]></style>
      <rect
        x="${zoneX}"
        y="${zoneY}"
        width="${zoneSize}"
        height="${zoneSize}"
        rx="${Math.round(MODULE_SIZE)}"
        fill="#ffffff"
      />
      <text
        x="${CANVAS_SIZE / 2}"
        y="${CANVAS_SIZE / 2 + 27}"
        text-anchor="middle"
        class="freed-logo-f"
        font-size="${fontSize}"
        fill="#050814"
      >F</text>
    </g>
  `;
}

function svgTemplate(mode, embeddedFontCss) {
  const renderedModules = [];

  for (let y = 0; y < GRID_SIZE; y += 1) {
    for (let x = 0; x < GRID_SIZE; x += 1) {
      if (!QR.modules[y][x]) continue;
      if (isFinderCell(x, y) || isLogoZoneCell(x, y)) continue;
      renderedModules.push(standardModule(x, y, mode));
    }
  }

  const finderGroups = [
    finderGroup(0, 0, mode),
    finderGroup(GRID_SIZE - 7, 0, mode),
    finderGroup(0, GRID_SIZE - 7, mode),
  ].join("\n");

  const quietZoneStroke =
    mode === "rebel"
      ? 'stroke="rgba(249,115,22,0.18)"'
      : mode === "melted"
        ? 'stroke="rgba(217,70,239,0.16)"'
        : 'stroke="rgba(59,130,246,0.14)"';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" viewBox="0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}" fill="none">
  <rect width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" rx="48" fill="#ffffff" />
  <rect
    x="${PADDING / 2}"
    y="${PADDING / 2}"
    width="${CANVAS_SIZE - PADDING}"
    height="${CANVAS_SIZE - PADDING}"
    rx="36"
    fill="none"
    ${quietZoneStroke}
    stroke-width="2"
  />
  ${finderGroups}
  ${renderedModules.join("\n")}
  ${centerBadge(mode, embeddedFontCss)}
</svg>`;
}

async function getEmbeddedFontCss() {
  const response = await fetch(LOGO_FONT_URL);
  if (!response.ok) {
    throw new Error(`Failed to download Space Grotesk font: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const base64 = buffer.toString("base64");
  return `@font-face {
    font-family: 'Space Grotesk Embedded';
    src: url(data:font/ttf;base64,${base64}) format('truetype');
    font-style: normal;
    font-weight: 700;
  }`;
}

async function main() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const embeddedFontCss = await getEmbeddedFontCss();

  for (const variant of variants) {
    writeFileSync(
      join(OUTPUT_DIR, `${variant.id}.svg`),
      svgTemplate(variant.mode, embeddedFontCss),
      "utf8",
    );
  }

  console.log(`Generated ${variants.length} QR variants for ${TARGET_URL}`);
}

await main();
