import type { PtRect } from "./types";

export type TextItem = {
  str: string;
  fontName: string;
  /** Text-space transform [a, b, c, d, e, f]; e/f is the origin in PDF points. */
  transform: number[];
  width: number;
  height: number;
};

export type PageText = {
  items: TextItem[];
  widthPt: number;
  heightPt: number;
};

type PdfjsModule = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const [mod, worker] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs"),
        import("pdfjs-dist/legacy/build/pdf.worker.mjs"),
      ]);
      // Serverless has no worker thread. Handing pdf.js the worker module
      // through this global makes it run in-process without resolving a path at
      // runtime — `require.resolve` returns a module id, not a file, once the
      // route is bundled.
      (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
      return mod;
    })();
  }
  return pdfjsPromise;
}

export type PageRange = { from?: number; count?: number };

/**
 * Extract the text layer. Fonts are never rendered.
 *
 * The range matters for throughput: the analyzer processes a document in
 * chunks, and parsing every page's text on each chunk would multiply the
 * single most expensive stage by the number of chunks. Index 0 of the result is
 * page `from`.
 */
export async function extractText(bytes: Uint8Array, range: PageRange = {}): Promise<PageText[]> {
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    useWorkerFetch: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;

  const first = Math.max(0, range.from ?? 0) + 1;
  const last = Math.min(doc.numPages, first - 1 + (range.count ?? doc.numPages));

  const pages: PageText[] = [];
  try {
    for (let i = first; i <= last; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const raw of content.items) {
        if (!("str" in raw)) continue;
        items.push({
          str: raw.str,
          fontName: raw.fontName,
          transform: raw.transform,
          width: raw.width,
          height: raw.height,
        });
      }
      pages.push({ items, widthPt: viewport.width, heightPt: viewport.height });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}

const EPS = 0.2;

/** Step 8: rotation of a single text item, in degrees counter-clockwise in PDF space. */
export function itemAngle(transform: number[]): 0 | 90 | 180 | 270 | null {
  const [a, b, c, d] = transform;
  if (Math.abs(b) < EPS && Math.abs(c) < EPS) {
    if (a > EPS) return 0;
    if (a < -EPS) return 180;
    return null;
  }
  if (Math.abs(a) < EPS && Math.abs(d) < EPS) {
    if (b > EPS) return 90;
    if (b < -EPS) return 270;
    return null;
  }
  return null;
}

export type Orientation = { angle: 0 | 90 | 180 | 270; unambiguous: boolean };

/**
 * Dominant text angle among items whose origin falls inside `crop`
 * (PDF points, origin lower-left).
 */
export function dominantAngle(items: TextItem[], crop: PtRect): Orientation {
  const votes = new Map<number, number>();
  for (const item of items) {
    if (!item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    if (x < crop.x || x > crop.x + crop.w || y < crop.y || y > crop.y + crop.h) continue;
    const angle = itemAngle(item.transform);
    if (angle === null) continue;
    // Weight by glyph count so a long address line outvotes a stray marker.
    votes.set(angle, (votes.get(angle) ?? 0) + item.str.trim().length);
  }
  if (votes.size === 0) return { angle: 0, unambiguous: false };
  const sorted = [...votes.entries()].sort((p, q) => q[1] - p[1]);
  const total = sorted.reduce((acc, [, n]) => acc + n, 0);
  const [angle, count] = sorted[0];
  return { angle: angle as 0 | 90 | 180 | 270, unambiguous: count / total >= 0.7 };
}

const CARRIERS = ["InPost", "Zásilkovna", "Zasilkovna", "GLS", "DPD", "ORLEN PACZKA", "Poczt"];

/** Carrier name from the text layer only — never from logos or OCR. */
export function detectCarrier(items: TextItem[], crop: PtRect): string | null {
  const inside = items
    .filter((item) => {
      const x = item.transform[4];
      const y = item.transform[5];
      return x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h;
    })
    .map((item) => item.str)
    .join(" ");
  for (const name of CARRIERS) {
    if (inside.toLowerCase().includes(name.toLowerCase())) {
      if (name === "Zasilkovna") return "Zásilkovna";
      if (name === "Poczt") return "Poczta Polska";
      return name;
    }
  }
  return null;
}

export type TitleBlock = {
  text: string;
  /** Lower edge of the title block in PDF points — a hard limit for the crop. */
  bottomPt: number;
};

/**
 * Step 9: the offer name is the topmost text item plus everything sharing its
 * font and size within 45 pt below it. Filtering by font is required: without
 * it, label fragments sitting at the same height ("Rejon kurierski:") leak into
 * the title.
 */
export function extractTitle(page: PageText): TitleBlock | null {
  const items = page.items.filter((item) => item.str.trim().length > 0);
  if (items.length === 0) return null;

  const topOf = (item: TextItem) => item.transform[5] + Math.abs(item.transform[3] || item.height);
  const top = items.reduce((acc, item) => (topOf(item) > topOf(acc) ? item : acc));
  const size = Math.abs(top.transform[3]) || top.height;
  const bandTop = topOf(top);
  const bandBottom = bandTop - 45;

  const inBand = items.filter((item) => {
    const y = item.transform[5];
    if (y > bandTop || y < bandBottom) return false;
    if (item.fontName !== top.fontName) return false;
    const itemSize = Math.abs(item.transform[3]) || item.height;
    return Math.abs(itemSize - size) < 0.5;
  });
  if (inBand.length === 0) return null;

  // Group into lines, then left to right within a line.
  const lineTolerance = Math.max(2, size * 0.5);
  const lines: TextItem[][] = [];
  for (const item of [...inBand].sort((p, q) => q.transform[5] - p.transform[5])) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[0].transform[5] - item.transform[5]) <= lineTolerance) last.push(item);
    else lines.push([item]);
  }

  const text = lines
    .map((line) =>
      [...line]
        .sort((p, q) => p.transform[4] - q.transform[4])
        .map((item) => item.str.trim())
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const bottomPt = Math.min(...inBand.map((item) => item.transform[5]));
  return { text, bottomPt };
}
