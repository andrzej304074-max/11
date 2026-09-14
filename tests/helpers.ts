import { readFileSync } from "node:fs";
import path from "node:path";

import { analyzeFile } from "../lib/analyze";
import { buildOutput } from "../lib/generate";
import { buildMask } from "../lib/mask";
import { DPI, loadPdf } from "../lib/raster";
import { dominantAngle, extractText } from "../lib/text";
import { MM, type AnalyzedItem, type GenerateItem } from "../lib/types";

export const fixture = (name: string) => readFileSync(path.join(process.cwd(), "fixtures", name));

export async function analyzeFixture(name: string): Promise<AnalyzedItem[]> {
  return analyzeFile(0, fixture(name));
}

export function toGenerateItems(items: AnalyzedItem[]): GenerateItem[] {
  return items.map((item, index) => ({
    id: item.id,
    fileIndex: item.fileIndex,
    pageIndex: item.pageIndex,
    crop: item.crop,
    rotate: item.rotate,
    titleFixed: item.titleFixed,
    include: true,
    order: index,
    padMm: item.padMm,
  }));
}

export async function renderFixture(name: string, withHeader = false): Promise<Uint8Array> {
  const items = await analyzeFixture(name);
  return buildOutput([fixture(name)], toGenerateItems(items), { withHeader });
}

export type Margins = { left: number; right: number; top: number; bottom: number };

/** Ink bounding box margins of one output page, in millimetres. */
export async function inkMargins(bytes: Uint8Array, pageIndex: number): Promise<Margins> {
  const pdf = await loadPdf(bytes);
  try {
    const page = await pdf.renderPage(pageIndex);
    const mask = buildMask(page.gray, page.width, page.height, DPI);
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < mask.h; y++) {
      const base = y * mask.w;
      for (let x = 0; x < mask.w; x++) {
        if (mask.ink[base + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) throw new Error("Strona wyjściowa jest pusta");
    const toMm = (px: number) => (px * 72) / DPI / MM;
    return {
      left: toMm(x0),
      right: toMm(mask.w - 1 - x1),
      top: toMm(y0),
      bottom: toMm(mask.h - 1 - y1),
    };
  } finally {
    pdf.destroy();
  }
}

export async function pageSizes(bytes: Uint8Array): Promise<{ widthPt: number; heightPt: number }[]> {
  const pdf = await loadPdf(bytes);
  try {
    return Array.from({ length: pdf.pageCount }, (_, i) => pdf.pageSize(i));
  } finally {
    pdf.destroy();
  }
}

export async function outputText(bytes: Uint8Array): Promise<string[]> {
  const pages = await extractText(bytes);
  return pages.map((page) => page.items.map((item) => item.str).join(" ").replace(/\s+/g, " ").trim());
}

/** Dominant text angle of a rendered output page — the orientation check. */
export async function outputAngles(bytes: Uint8Array): Promise<{ angle: number; unambiguous: boolean }[]> {
  const pages = await extractText(bytes);
  return pages.map((page) =>
    dominantAngle(page.items, { x: 0, y: 0, w: page.widthPt, h: page.heightPt }),
  );
}
