import { readFile } from "node:fs/promises";
import path from "node:path";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont, type PDFPage, degrees, rgb } from "pdf-lib";

import { MM, SHEET_H, SHEET_W, type GenerateItem } from "./types";

const HEADER_SIDE_MM = 3;
const HEADER_SIZES = [9.5, 8.5, 7.5, 6.5];
const HEADER_MAX_LINES = 3;
const LINE_RATIO = 1.22;
const RULE_WIDTH = 0.6;

let fontBytesPromise: Promise<Uint8Array> | null = null;

/**
 * The header font ships in the repository: Vinted's own fonts have no Polish
 * glyphs and a runtime CDN fetch would be one more thing to fail in a lambda.
 */
function loadFontBytes(): Promise<Uint8Array> {
  if (!fontBytesPromise) {
    fontBytesPromise = readFile(path.join(process.cwd(), "fonts", "DejaVuSans-Bold.ttf"));
  }
  return fontBytesPromise;
}

/** Greedy word wrap, hard-splitting any single word that cannot fit. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        line = candidate;
        continue;
      }
      // A single word wider than the column.
      let chunk = "";
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk += ch;
        }
      }
      line = chunk;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Largest of the allowed sizes at which the title fits in three lines. */
export function fitHeader(text: string, font: PDFFont, maxWidth: number): { size: number; lines: string[] } {
  for (const size of HEADER_SIZES) {
    const lines = wrapText(text, font, size, maxWidth);
    if (lines.length <= HEADER_MAX_LINES) return { size, lines };
  }
  const size = HEADER_SIZES[HEADER_SIZES.length - 1];
  return { size, lines: wrapText(text, font, size, maxWidth).slice(0, HEADER_MAX_LINES) };
}

/** Draws the header and returns the y coordinate left for the label. */
function drawHeader(page: PDFPage, font: PDFFont, title: string): number {
  const maxWidth = SHEET_W - 2 * HEADER_SIDE_MM * MM;
  const { size, lines } = fitHeader(title, font, maxWidth);
  const leading = size * LINE_RATIO;
  let y = SHEET_H - 2 * MM - size;
  for (const line of lines) {
    page.drawText(line, { x: HEADER_SIDE_MM * MM, y, size, font, color: rgb(0, 0, 0) });
    y -= leading;
  }
  const ruleY = y + leading - size - 1.5 * MM;
  page.drawRectangle({
    x: HEADER_SIDE_MM * MM,
    y: ruleY,
    width: maxWidth,
    height: RULE_WIDTH,
    color: rgb(0, 0, 0),
  });
  return ruleY;
}

export type PlacedBox = { x: number; y: number; displayW: number; displayH: number; scale: number };

/**
 * Anchor for pdf-lib's drawPage so that a page of `w` x `h`, scaled uniformly
 * and turned `rotate` degrees clockwise, lands centred in the given area.
 * pdf-lib rotates about the anchor point and counts degrees counter-clockwise.
 */
export function placement(
  w: number,
  h: number,
  rotate: 0 | 90 | 180 | 270,
  areaX: number,
  areaY: number,
  areaW: number,
  areaH: number,
): PlacedBox {
  const swap = rotate === 90 || rotate === 270;
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  const scale = Math.min(areaW / outW, areaH / outH);
  const sw = w * scale;
  const sh = h * scale;
  const displayW = swap ? sh : sw;
  const displayH = swap ? sw : sh;
  const cx = areaX + areaW / 2;
  const cy = areaY + areaH / 2;

  switch (rotate) {
    case 0:
      return { x: cx - sw / 2, y: cy - sh / 2, displayW, displayH, scale };
    case 90:
      return { x: cx - sh / 2, y: cy + sw / 2, displayW, displayH, scale };
    case 180:
      return { x: cx + sw / 2, y: cy + sh / 2, displayW, displayH, scale };
    default:
      return { x: cx + sh / 2, y: cy - sw / 2, displayW, displayH, scale };
  }
}

/** pdf-lib measures rotation counter-clockwise; our `rotate` is clockwise. */
export function pdfLibAngle(rotate: 0 | 90 | 180 | 270): number {
  return (360 - rotate) % 360;
}

export type GenerateOptions = { withHeader: boolean };

/**
 * Build the merged 100 x 150 mm PDF. Output stays vector: source pages are
 * embedded, never rasterized, so barcodes keep their crisp edges.
 */
export async function buildOutput(
  files: Uint8Array[],
  items: GenerateItem[],
  options: GenerateOptions,
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const font = options.withHeader ? await out.embedFont(await loadFontBytes(), { subset: true }) : null;

  const sources = new Map<number, PDFDocument>();
  const selected = items
    .filter((item) => item.include)
    .sort((a, b) => a.order - b.order);

  for (const item of selected) {
    let src = sources.get(item.fileIndex);
    if (!src) {
      const bytes = files[item.fileIndex];
      if (!bytes) throw new Error(`Brak pliku o indeksie ${item.fileIndex}`);
      src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      sources.set(item.fileIndex, src);
    }
    const srcPage = src.getPage(item.pageIndex);

    // boundingBox clips the embedded content, so anything outside the crop
    // (GLS instructions, the second copy) cannot leak onto the sticker.
    const embedded = await out.embedPage(srcPage, {
      left: item.crop.x,
      bottom: item.crop.y,
      right: item.crop.x + item.crop.w,
      top: item.crop.y + item.crop.h,
    });

    const page = out.addPage([SHEET_W, SHEET_H]);
    const pad = item.padMm * MM;
    // With a header the label gets the whole area below the rule.
    const topLimit =
      font && item.titleFixed.trim() ? drawHeader(page, font, item.titleFixed.trim()) - pad : SHEET_H - pad;

    const areaY = pad;
    const areaH = Math.max(1, topLimit - areaY);
    const box = placement(item.crop.w, item.crop.h, item.rotate, pad, areaY, SHEET_W - 2 * pad, areaH);

    page.drawPage(embedded, {
      x: box.x,
      y: box.y,
      xScale: box.scale,
      yScale: box.scale,
      rotate: degrees(pdfLibAngle(item.rotate)),
    });
  }

  if (out.getPageCount() === 0) throw new Error("Nie wybrano żadnej etykiety do druku");
  return out.save();
}
