/** Shared types for the label pipeline. */

/** A rectangle in raster pixel space (origin top-left, Y down). */
export type PxRect = { x: number; y: number; w: number; h: number };

/** A rectangle in PDF point space (origin bottom-left, Y up). */
export type PtRect = { x: number; y: number; w: number; h: number };

export type LabelKind = "label" | "qr-only" | "unknown";

export type AnalyzedItem = {
  id: string;
  fileIndex: number;
  pageIndex: number;
  /** Crop in PDF points, origin lower-left. */
  crop: PtRect;
  /** Clockwise rotation in degrees to apply so the label text stands upright. */
  rotate: 0 | 90 | 180 | 270;
  /** Raw product title as found in the text layer (may lack Polish diacritics). */
  title: string;
  /** Title after dictionary repair — what the UI shows and pre-fills. */
  titleFixed: string;
  carrier: string | null;
  kind: LabelKind;
  /** Set when this item came from splitting a multi-part sheet. */
  splitOf?: string;
  /** Adaptive padding in millimetres used when placing on the 100x150 sheet. */
  padMm: number;
  confidence: number;
  /** data:image/png;base64,... preview of the cropped, rotated label. */
  previewPng: string;
  /** True when the dilation fallback (step 6) was used — no frame around the label. */
  sparse: boolean;
  /** Human-readable notes for the UI (low confidence reasons). */
  notes: string[];
};

export type GenerateItem = {
  id: string;
  fileIndex: number;
  pageIndex: number;
  crop: PtRect;
  rotate: 0 | 90 | 180 | 270;
  titleFixed: string;
  include: boolean;
  order: number;
  padMm: number;
};

/** 100 x 150 mm in PDF points. */
export const SHEET_W = 283.465;
export const SHEET_H = 425.197;
export const MM = 72 / 25.4;
