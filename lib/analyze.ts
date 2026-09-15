import { fixDiacritics } from "./diacritics";
import { cropGray, downscale, rotateGray } from "./image";
import {
  type Axis,
  type Mask,
  buildMask,
  clearAbove,
  detectLabelBlock,
  hasBarcode,
  internalDividers,
  segmentColumns,
  trimTopTitleBand,
} from "./mask";
import { encodeGrayPng } from "./png";
import { DPI, loadPdf } from "./raster";
import { type PageText, type TextItem, detectCarrier, dominantAngle, extractText, extractTitle } from "./text";
import { MM, SHEET_H, SHEET_W, type AnalyzedItem, type PtRect, type PxRect } from "./types";

const PAD_FRAMED_MM = 1.5;
const PAD_SPARSE_MM = 6;
const MIN_SCALE = 0.75;

export function pxToPt(rect: PxRect, heightPt: number, dpi: number): PtRect {
  const k = 72 / dpi;
  return {
    x: rect.x * k,
    y: heightPt - (rect.y + rect.h) * k,
    w: rect.w * k,
    h: rect.h * k,
  };
}

/**
 * Scale at which `crop` would fit a 100x150 mm sheet with `padMm` of margin,
 * measured after the upright rotation is applied.
 */
export function fitScale(crop: PtRect, rotate: number, padMm: number): number {
  const swap = rotate === 90 || rotate === 270;
  const w = swap ? crop.h : crop.w;
  const h = swap ? crop.w : crop.h;
  const availW = SHEET_W - 2 * padMm * MM;
  const availH = SHEET_H - 2 * padMm * MM;
  return Math.min(availW / w, availH / h);
}

function itemsInside(items: TextItem[], crop: PtRect): TextItem[] {
  return items.filter((item) => {
    const x = item.transform[4];
    const y = item.transform[5];
    return x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h;
  });
}

/** Order of the two halves of a split sheet, in the label's own reading order. */
function firstHalfIsLower(rotate: number): boolean {
  return rotate === 180 || rotate === 270;
}

type PageAnalysis = {
  items: AnalyzedItem[];
};

async function analyzePage(
  fileIndex: number,
  pageIndex: number,
  gray: Uint8Array,
  width: number,
  height: number,
  widthPt: number,
  heightPt: number,
  text: PageText | undefined,
): Promise<PageAnalysis> {
  const mask: Mask = buildMask(gray, width, height, DPI);

  // Step 9's limiter runs first and is the precise signal: the text layer says
  // exactly where the offer name ends. Applied before segmentation so the name
  // can never be dilated into the label block — a two-line name forms one
  // ~0.41 inch band and slips past step 3's height test.
  const titleBlock = text ? extractTitle(text) : null;
  let titleFloor = Number.POSITIVE_INFINITY;
  if (titleBlock) {
    // bottomPt is a baseline: "p", "gg" and "y" hang below it, and a flat
    // couple of points is not enough for a large name — the tails survive and
    // print as specks along the top of the sticker.
    const descender = 0.35 * titleBlock.size;
    titleFloor = ((heightPt - (titleBlock.bottomPt - descender)) * DPI) / 72;
    clearAbove(mask, titleFloor);
  }

  // Step 3 then mops up anything left above that edge. It is the whole answer
  // only when a page has no text layer to read the name from.
  trimTopTitleBand(mask, titleFloor);

  const { column, duplicates } = segmentColumns(mask);
  const block = detectLabelBlock(mask, column);
  const baseId = `f${fileIndex}-p${pageIndex}`;
  if (!block) return { items: [] };

  const cropPx = block.crop;
  const cropPt = pxToPt(cropPx, heightPt, DPI);
  const items = text?.items ?? [];
  const orientation = dominantAngle(items, cropPt);
  const rotate = orientation.angle;

  const padMm = block.sparse ? PAD_SPARSE_MM : PAD_FRAMED_MM;
  const barcode = hasBarcode(mask, cropPx);
  const textCount = itemsInside(items, cropPt).filter((i) => i.str.trim()).length;
  const kind = barcode ? "label" : textCount < 12 ? "qr-only" : "unknown";

  const title = titleBlock?.text ?? "";
  const pageArea = (width * height) || 1;
  const cropArea = cropPx.w * cropPx.h;

  // Step 7: a sheet carrying two different labels (a cross-border handover)
  // squeezes to an unreadable strip unless it is split at its internal divider.
  const axis: Axis = rotate === 90 || rotate === 270 ? "col" : "row";
  const scale = fitScale(cropPt, rotate, padMm);
  let parts: PxRect[] = [cropPx];
  let split = false;
  if (scale < MIN_SCALE) {
    const lo = axis === "row" ? cropPx.y : cropPx.x;
    const size = axis === "row" ? cropPx.h : cropPx.w;
    const dividers = internalDividers(mask, cropPx, axis).filter(
      (v) => v > lo + size / 3 && v < lo + (2 * size) / 3,
    );
    if (dividers.length > 0) {
      const cut = dividers.reduce((acc, v) =>
        Math.abs(v - (lo + size / 2)) < Math.abs(acc - (lo + size / 2)) ? v : acc,
      );
      parts =
        axis === "row"
          ? [
              { ...cropPx, h: cut - cropPx.y },
              { ...cropPx, y: cut, h: cropPx.y + cropPx.h - cut },
            ]
          : [
              { ...cropPx, w: cut - cropPx.x },
              { ...cropPx, x: cut, w: cropPx.x + cropPx.w - cut },
            ];
      split = true;
    }
  }

  if (split && firstHalfIsLower(rotate)) parts = [parts[1], parts[0]];

  const out: AnalyzedItem[] = [];
  for (let i = 0; i < parts.length; i++) {
    const partPx = parts[i];
    const partPt = pxToPt(partPx, heightPt, DPI);
    const carrier = detectCarrier(items, partPt);

    const notes: string[] = [];
    let confidence = 0.95;
    if (block.sparse) {
      confidence -= 0.25;
      notes.push("Etykieta bez ramki — kadr z awaryjnej ścieżki, sprawdź obcięcie.");
    }
    if (cropArea > 0.9 * pageArea) {
      confidence -= 0.2;
      notes.push("Kadr zajmuje ponad 90% strony — mógł objąć treść spoza etykiety.");
    }
    if (!orientation.unambiguous) {
      confidence -= 0.2;
      notes.push("Warstwa tekstowa nie dała jednoznacznej orientacji — sprawdź obrót.");
    }
    if (split) {
      confidence -= 0.15;
      notes.push("Etykieta dwuczęściowa, obie części naklej na tę samą paczkę.");
    }
    const partScale = fitScale(partPt, rotate, padMm);
    if (partScale < MIN_SCALE) {
      confidence -= 0.15;
      const pct = (value: number) => `${Math.round(value * 100)}%`;
      // A label that is wider than it is tall wastes most of a portrait
      // sticker. Turning it sideways can buy back a lot of size, so say so —
      // the rotation buttons are right there — rather than only warning.
      const turned = fitScale(partPt, ((rotate + 90) % 360) as 0 | 90 | 180 | 270, padMm);
      notes.push(
        turned > partScale * 1.25
          ? `Etykieta zmieści się dopiero w ${pct(partScale)} oryginału. Obrócona o 90° zmieściłaby ` +
            `się w ${pct(turned)} — kody byłyby wyraźnie czytelniejsze, tylko tekst stanie bokiem.`
          : `Etykieta zmieści się dopiero w ${pct(partScale)} oryginału — na drukarce 203 DPI ` +
            "cienkie kreski kodu mogą się zlewać. Zrób wydruk próbny i zeskanuj kod.",
      );
    }
    if (duplicates) {
      notes.push("Strona zawierała dwie kopie — wzięto lewą.");
    }

    let partTitle = title;
    if (split) {
      const who = carrier ?? `część ${i + 1}`;
      partTitle = `${title} — ${who} (${i + 1} z 2)`.trim();
    }

    const bmp = downscale(rotateGray(cropGray(gray, width, partPx), rotate), 260);
    const previewPng = `data:image/png;base64,${encodeGrayPng(bmp.data, bmp.width, bmp.height).toString("base64")}`;

    out.push({
      id: split ? `${baseId}-${String.fromCharCode(97 + i)}` : `${baseId}-a`,
      fileIndex,
      pageIndex,
      crop: partPt,
      rotate,
      title: partTitle,
      titleFixed: fixDiacritics(partTitle),
      carrier,
      kind: split ? "label" : kind,
      ...(split ? { splitOf: baseId } : {}),
      padMm,
      confidence: Math.max(0.1, Math.round(confidence * 100) / 100),
      previewPng,
      sparse: block.sparse,
      notes,
    });

  }

  return { items: out };
}

export type AnalyzeRange = { from?: number; count?: number };
export type AnalyzeResult = { items: AnalyzedItem[]; pageCount: number };
export type PageResult = { pageIndex: number; pageCount: number; items: AnalyzedItem[] };

/**
 * Analyze one uploaded PDF page by page, optionally only a slice of it.
 *
 * Yielding per page is what lets the route stream results: the document is
 * fetched, normalized and parsed exactly once, while the interface still fills
 * in as labels are found. Pages are processed one at a time and no bitmap is
 * kept — a batch of thirty labels would otherwise hold well over a hundred
 * megabytes of grayscale at once.
 */
export async function* analyzePages(
  fileIndex: number,
  bytes: Uint8Array,
  range: AnalyzeRange = {},
): AsyncGenerator<PageResult> {
  const pdf = await loadPdf(bytes);
  try {
    const from = Math.min(Math.max(0, range.from ?? 0), pdf.pageCount);
    const to = Math.min(pdf.pageCount, from + (range.count ?? pdf.pageCount));
    const pages = await extractText(bytes, { from, count: to - from }).catch((error: unknown) => {
      // A missing text layer costs titles and orientation but not the crop, so
      // keep going — and say so, since it is never normal.
      console.warn("text layer unavailable:", error instanceof Error ? error.message : "unknown");
      return [] as PageText[];
    });

    for (let pageIndex = from; pageIndex < to; pageIndex++) {
      const page = await pdf.renderPage(pageIndex);
      const result = await analyzePage(
        fileIndex,
        pageIndex,
        page.gray,
        page.width,
        page.height,
        page.widthPt,
        page.heightPt,
        pages[pageIndex - from],
      );
      // Drop the bitmap before moving to the next page.
      page.gray.fill(0);
      yield { pageIndex, pageCount: pdf.pageCount, items: result.items };
    }

    // An empty slice still has to report the document's length.
    if (from >= to) yield { pageIndex: from, pageCount: pdf.pageCount, items: [] };
  } finally {
    pdf.destroy();
  }
}

/** Collecting wrapper for callers that want the whole answer at once. */
export async function analyzeFile(
  fileIndex: number,
  bytes: Uint8Array,
  range: AnalyzeRange = {},
): Promise<AnalyzeResult> {
  const items: AnalyzedItem[] = [];
  let pageCount = 0;
  for await (const page of analyzePages(fileIndex, bytes, range)) {
    items.push(...page.items);
    pageCount = page.pageCount;
  }
  return { items, pageCount };
}
