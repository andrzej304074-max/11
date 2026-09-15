import type { PxRect } from "./types";

/**
 * Binary ink mask over a rasterized page. `ink[y * w + x]` is 1 for ink.
 * All thresholds in this module are expressed in inches x DPI so they stay
 * resolution independent.
 */
export type Mask = { ink: Uint8Array; w: number; h: number; dpi: number };

export const INK_THRESHOLD = 200;

/** Step 2: a pixel is ink when its luminance is below 200. */
export function buildMask(gray: Uint8Array, w: number, h: number, dpi: number): Mask {
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < ink.length; i++) ink[i] = gray[i] < INK_THRESHOLD ? 1 : 0;
  return { ink, w, h, dpi };
}

function rowHasInk(m: Mask, y: number, x0 = 0, x1 = m.w - 1): boolean {
  const base = y * m.w;
  for (let x = x0; x <= x1; x++) if (m.ink[base + x]) return true;
  return false;
}

/**
 * Step 3: strip the marketplace's offer name glued above the label.
 * It is not part of the label and must not enter the crop — on some layouts it
 * sits right above the frame and merges with it during dilation.
 *
 * `floorY` is the lower edge of the offer name as read from the text layer,
 * below which nothing may be stripped. Without it this heuristic misfires on
 * landscape sheets: the "top 15% of the page" test spans only about 92 pt
 * there, and a frameless label whose sender block starts at 56 pt loses four of
 * its own lines to the four passes.
 */
export function trimTopTitleBand(m: Mask, floorY = Number.POSITIVE_INFINITY): void {
  const gap = Math.round(0.053 * m.dpi); // 8 px at 150 DPI
  const maxBandHeight = 0.35 * m.dpi;
  const topZone = 0.15 * m.h;

  for (let attempt = 0; attempt < 4; attempt++) {
    let top = -1;
    for (let y = 0; y < m.h; y++) {
      if (rowHasInk(m, y)) {
        top = y;
        break;
      }
    }
    if (top < 0 || top >= floorY) return;

    // Grow downwards while the run of empty rows stays within `gap`.
    let bottom = top;
    let empty = 0;
    for (let y = top + 1; y < m.h; y++) {
      if (rowHasInk(m, y)) {
        bottom = y;
        empty = 0;
      } else if (++empty > gap) {
        break;
      }
    }

    const height = bottom - top + 1;
    if (height < maxBandHeight && top < topZone) {
      m.ink.fill(0, top * m.w, (bottom + 1) * m.w);
    } else {
      return;
    }
  }
}

export type Column = { x0: number; x1: number };

type Band = Column & { width: number; ink: number; top: number; bottom: number };

/**
 * Step 4: split the page into vertical bands of ink and drop the narrow ones
 * (instruction strips, the cut line, the scissors glyph). When two or more
 * label-sized bands match each other they are duplicate copies of the same
 * label; the leftmost one is the copy meant for the parcel, the other goes
 * inside in case of a return.
 *
 * Matching is on width, height and ink volume together. Width alone is not
 * enough: the white gaps of a wide barcode can break a single frameless label
 * into bands of accidentally similar width, and treating those as duplicates
 * throws away most of the label.
 */
export function segmentColumns(m: Mask): { column: Column; duplicates: boolean } {
  const gap = Math.round(0.067 * m.dpi); // 10 px at 150 DPI
  const profile = new Int32Array(m.w);
  for (let y = 0; y < m.h; y++) {
    const base = y * m.w;
    for (let x = 0; x < m.w; x++) if (m.ink[base + x]) profile[x]++;
  }

  const ranges: Column[] = [];
  let start = -1;
  let empty = 0;
  for (let x = 0; x < m.w; x++) {
    if (profile[x] > 0) {
      if (start < 0) start = x;
      empty = 0;
    } else if (start >= 0 && ++empty > gap) {
      ranges.push({ x0: start, x1: x - empty });
      start = -1;
      empty = 0;
    }
  }
  if (start >= 0) ranges.push({ x0: start, x1: m.w - 1 });

  const minWidth = 0.35 * m.dpi;
  const bands: Band[] = [];
  for (const range of ranges) {
    const width = range.x1 - range.x0 + 1;
    if (width < minWidth) continue;
    let ink = 0;
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < m.h; y++) {
      const base = y * m.w;
      let rowInk = 0;
      for (let x = range.x0; x <= range.x1; x++) if (m.ink[base + x]) rowInk++;
      if (rowInk) {
        if (top < 0) top = y;
        bottom = y;
        ink += rowInk;
      }
    }
    bands.push({ ...range, width, ink, top, bottom });
  }
  if (bands.length === 0) return { column: { x0: 0, x1: m.w - 1 }, duplicates: false };

  const minCopyWidth = 1.5 * m.dpi;
  const near = (a: number, b: number, tolerance: number) =>
    Math.abs(a - b) / Math.max(a, b) < tolerance;

  for (const candidate of bands) {
    if (candidate.width < minCopyWidth) continue;
    const copies = bands.filter(
      (other) =>
        other.width >= minCopyWidth &&
        near(other.width, candidate.width, 0.15) &&
        near(other.bottom - other.top + 1, candidate.bottom - candidate.top + 1, 0.15) &&
        near(other.ink, candidate.ink, 0.25),
    );
    if (copies.length >= 2) return { column: copies[0], duplicates: true };
  }

  // No duplicates: the surviving bands are parts of one label, take their span.
  return {
    column: { x0: bands[0].x0, x1: bands[bands.length - 1].x1 },
    duplicates: false,
  };
}

/** Sliding-window maximum over a 1-D slice; O(n) regardless of window size. */
function maxFilter1d(src: Uint8Array, dst: Uint8Array, n: number, radius: number, stride: number, offset: number): void {
  const deque = new Int32Array(n);
  let head = 0;
  let tail = 0;
  let next = 0;
  for (let i = 0; i < n; i++) {
    const limit = Math.min(n - 1, i + radius);
    while (next <= limit) {
      const v = src[offset + next * stride];
      while (tail > head && src[offset + deque[tail - 1] * stride] <= v) tail--;
      deque[tail++] = next;
      next++;
    }
    while (deque[head] < i - radius) head++;
    dst[offset + i * stride] = src[offset + deque[head] * stride];
  }
}

/** Dilation by a square structuring element, separated into two passes. */
export function dilate(m: Mask, inches: number): Uint8Array {
  const radius = Math.max(1, Math.round((inches * m.dpi) / 2));
  const tmp = new Uint8Array(m.w * m.h);
  const out = new Uint8Array(m.w * m.h);
  for (let y = 0; y < m.h; y++) maxFilter1d(m.ink, tmp, m.w, radius, 1, y * m.w);
  for (let x = 0; x < m.w; x++) maxFilter1d(tmp, out, m.h, radius, m.w, x);
  return out;
}

export type Region = { rect: PxRect; inkCount: number; inkRect: PxRect };

/** Tight bounding box of original ink inside `rect`. */
function inkBounds(m: Mask, rect: PxRect): { box: PxRect; count: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const base = y * m.w;
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (m.ink[base + x]) {
        count++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return { box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, count };
}

/** 8-connected components of the dilated mask, restricted to one column. */
function components(m: Mask, dilated: Uint8Array, column: Column): PxRect[] {
  const labels = new Int32Array(m.w * m.h);
  const rects: PxRect[] = [];
  const stack: number[] = [];
  let current = 0;

  for (let y = 0; y < m.h; y++) {
    for (let x = column.x0; x <= column.x1; x++) {
      const idx = y * m.w + x;
      if (!dilated[idx] || labels[idx]) continue;
      current++;
      labels[idx] = current;
      stack.push(idx);
      let x0 = x;
      let x1 = x;
      let y0 = y;
      let y1 = y;
      while (stack.length) {
        const p = stack.pop()!;
        const py = (p / m.w) | 0;
        const px = p - py * m.w;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
        for (let dy = -1; dy <= 1; dy++) {
          const ny = py + dy;
          if (ny < 0 || ny >= m.h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = px + dx;
            if (nx < column.x0 || nx > column.x1) continue;
            const n = ny * m.w + nx;
            if (dilated[n] && !labels[n]) {
              labels[n] = current;
              stack.push(n);
            }
          }
        }
      }
      rects.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
  }
  return rects;
}

export type BlockResult = { crop: PxRect; sparse: boolean; stacked: boolean };

/**
 * Steps 5 and 6: find the label block inside a column.
 *
 * The winner is picked by ink pixel count, never by bounding-box area: on GLS
 * sheets the instruction block is both taller and wider than the label, so an
 * area criterion picks the wrong region. The label wins on density — barcodes,
 * QR codes and solid bars.
 */
export function detectLabelBlock(m: Mask, column: Column): BlockResult | null {
  const columnRect: PxRect = { x: column.x0, y: 0, w: column.x1 - column.x0 + 1, h: m.h };
  const columnInk = inkBounds(m, columnRect);
  if (!columnInk) return null;

  const dilated = dilate(m, 0.5);
  const minSide = 0.8 * m.dpi;
  const candidates: Region[] = [];
  for (const rect of components(m, dilated, column)) {
    if (rect.w < minSide || rect.h < minSide) continue;
    const bounds = inkBounds(m, rect);
    if (!bounds) continue;
    // The size test has to land on the tight ink box, not on the dilated
    // region: dilation adds a quarter inch on every side, which is enough to
    // lift a fragment well under the minimum above it. A lone barcode on a
    // frameless label measures 0.53 inch tall and its dilated region 1.03 —
    // judged on the latter it wins the page and the crop keeps only the
    // barcode.
    if (bounds.box.w < minSide || bounds.box.h < minSide) continue;
    candidates.push({ rect, inkCount: bounds.count, inkRect: bounds.box });
  }
  if (candidates.length === 0) {
    return { crop: columnInk.box, sparse: true, stacked: false };
  }

  // Step 6b: two near-identical blocks stacked vertically are two copies of the
  // same label — keep the upper one.
  let stacked = false;
  let pool = candidates;
  if (candidates.length === 2) {
    const [a, b] = [...candidates].sort((p, q) => p.rect.y - q.rect.y);
    const similar =
      Math.abs(a.rect.w - b.rect.w) / Math.max(a.rect.w, b.rect.w) < 0.15 &&
      Math.abs(a.rect.h - b.rect.h) / Math.max(a.rect.h, b.rect.h) < 0.15;
    const vertical = a.rect.y + a.rect.h <= b.rect.y;
    if (similar && vertical) {
      pool = [a];
      stacked = true;
    }
  }

  const best = pool.reduce((acc, r) => (r.inkCount > acc.inkCount ? r : acc));

  // Step 6a: a label whose parts sit too far apart for the dilation to join
  // (Poczta Polska) leaves the winner holding only a fragment of the column's
  // ink. Fall back to the bounding box of everything in the column.
  if (best.inkCount < 0.5 * columnInk.count) {
    return { crop: columnInk.box, sparse: true, stacked };
  }
  return { crop: best.inkRect, sparse: false, stacked };
}

export type Axis = "row" | "col";

/**
 * Step 7: lines inside the crop where ink covers more than 90% of the crop's
 * span. The outermost two are the frame; anything between them is an internal
 * divider. `axis` is "row" for an upright label and "col" for a sideways one,
 * so dividers are always measured across the label's short axis.
 */
export function horizontalRules(m: Mask, crop: PxRect, axis: Axis = "row"): number[] {
  const along = axis === "row" ? crop.h : crop.w;
  const across = axis === "row" ? crop.w : crop.h;
  const need = 0.9 * across;
  const rules: number[] = [];
  let runStart = -1;

  for (let i = 0; i < along; i++) {
    let count = 0;
    for (let j = 0; j < across; j++) {
      const x = axis === "row" ? crop.x + j : crop.x + i;
      const y = axis === "row" ? crop.y + i : crop.y + j;
      if (m.ink[y * m.w + x]) count++;
    }
    const pos = (axis === "row" ? crop.y : crop.x) + i;
    if (count >= need) {
      if (runStart < 0) runStart = pos;
    } else if (runStart >= 0) {
      rules.push(Math.round((runStart + pos - 1) / 2));
      runStart = -1;
    }
  }
  if (runStart >= 0) rules.push(Math.round((runStart + (axis === "row" ? crop.y + crop.h : crop.x + crop.w) - 1) / 2));
  return rules;
}

/** Internal dividers only — the frame edges are removed. */
export function internalDividers(m: Mask, crop: PxRect, axis: Axis = "row"): number[] {
  const rules = horizontalRules(m, crop, axis);
  const edge = 0.05 * m.dpi;
  const lo = axis === "row" ? crop.y : crop.x;
  const hi = lo + (axis === "row" ? crop.h : crop.w) - 1;
  return rules.filter((v) => v - lo > edge && hi - v > edge);
}

/**
 * A 1-D barcode shows up as a run of lines with many ink transitions across it.
 * QR blocks transition far less often per line, which is what separates a real
 * shipping label from a "scan this code at the locker" page.
 */
export function hasBarcode(m: Mask, crop: PxRect): boolean {
  const minTransitions = 25;
  const minRun = Math.round(0.1 * m.dpi);

  for (const axis of ["row", "col"] as Axis[]) {
    const along = axis === "row" ? crop.h : crop.w;
    const across = axis === "row" ? crop.w : crop.h;
    let run = 0;
    for (let i = 0; i < along; i++) {
      let transitions = 0;
      let prev = 0;
      for (let j = 0; j < across; j++) {
        const x = axis === "row" ? crop.x + j : crop.x + i;
        const y = axis === "row" ? crop.y + i : crop.y + j;
        const v = m.ink[y * m.w + x];
        if (v && !prev) transitions++;
        prev = v;
      }
      if (transitions >= minTransitions) {
        if (++run >= minRun) return true;
      } else {
        run = 0;
      }
    }
  }
  return false;
}

/** Total ink pixels inside a rectangle. */
export function inkCount(m: Mask, rect: PxRect): number {
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const base = y * m.w;
    for (let x = rect.x; x < rect.x + rect.w; x++) if (m.ink[base + x]) count++;
  }
  return count;
}

/** Zero every row above `y` — used to enforce the title limiter from step 9. */
export function clearAbove(m: Mask, y: number): void {
  const limit = Math.max(0, Math.min(m.h, Math.ceil(y)));
  m.ink.fill(0, 0, limit * m.w);
}
