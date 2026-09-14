import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { fitScale, pxToPt } from "../lib/analyze";
import { fixDiacritics } from "../lib/diacritics";
import { fitHeader, pdfLibAngle, placement, wrapText } from "../lib/generate";
import { buildMask, segmentColumns, trimTopTitleBand } from "../lib/mask";
import { itemAngle } from "../lib/text";
import { MM, SHEET_H, SHEET_W } from "../lib/types";

describe("konwersja współrzędnych", () => {
  it("odwraca oś Y między przestrzenią obrazu a PDF", () => {
    // A 150 DPI page of a 612 x 792 pt sheet is 1275 x 1650 px.
    const rect = pxToPt({ x: 208, y: 400, w: 417, h: 209 }, 792, 150);
    expect(rect.x).toBeCloseTo(99.84, 2);
    expect(rect.w).toBeCloseTo(200.16, 2);
    // Image row 400 is 192 pt from the top, so the box bottom sits at 792-292.
    expect(rect.y).toBeCloseTo(499.68, 2);
    expect(rect.h).toBeCloseTo(100.32, 2);
  });

  it("liczy skalę dopasowania z uwzględnieniem obrotu", () => {
    const landscape = { x: 0, y: 0, w: 425.197, h: 283.465 };
    // Sideways it fits after the upright rotation, but not before it.
    expect(fitScale(landscape, 90, 0)).toBeCloseTo(1, 3);
    expect(fitScale(landscape, 0, 0)).toBeLessThan(0.7);
  });
});

describe("orientacja z macierzy transformacji", () => {
  it.each([
    [[11, 0, 0, 11, 50, 700], 0],
    [[-11, 0, 0, -11, 50, 700], 180],
    [[0, 10, -10, 0, 300, 300], 90],
    [[0, -10, 10, 0, 300, 300], 270],
  ])("%j daje %i stopni", (transform, expected) => {
    expect(itemAngle(transform as number[])).toBe(expected);
  });

  it("zwraca null dla macierzy skośnej", () => {
    expect(itemAngle([7, 7, -7, 7, 0, 0])).toBeNull();
  });
});

describe("umieszczenie na naklejce", () => {
  const area = { x: 10, y: 10, w: 200, h: 300 };

  it.each([0, 90, 180, 270] as const)("obrót %i stopni centruje zawartość", (rotate) => {
    const box = placement(100, 150, rotate, area.x, area.y, area.w, area.h);
    const sw = 100 * box.scale;
    const sh = 150 * box.scale;
    // Re-derive the occupied rectangle the way pdf-lib's drawPage does.
    const theta = (pdfLibAngle(rotate) * Math.PI) / 180;
    const corners = [
      [0, 0],
      [sw, 0],
      [0, sh],
      [sw, sh],
    ].map(([u, v]) => [
      box.x + u * Math.cos(theta) - v * Math.sin(theta),
      box.y + u * Math.sin(theta) + v * Math.cos(theta),
    ]);
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(area.x + area.w / 2, 5);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(area.y + area.h / 2, 5);
    // And it stays inside the area.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(area.x - 1e-6);
    expect(Math.max(...xs)).toBeLessThanOrEqual(area.x + area.w + 1e-6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(area.y - 1e-6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(area.y + area.h + 1e-6);
  });

  it("skaluje jednorodnie, nigdy osobno w obu osiach", () => {
    const box = placement(100, 150, 0, 0, 0, SHEET_W, SHEET_H);
    expect(box.displayW / 100).toBeCloseTo(box.displayH / 150, 9);
  });
});

describe("nagłówek", () => {
  it("zmniejsza font aż nazwa zmieści się w trzech wierszach", async () => {
    const pdf = await PDFDocument.create();
    const fontkit = (await import("@pdf-lib/fontkit")).default;
    pdf.registerFontkit(fontkit);
    const { readFileSync } = await import("node:fs");
    const font = await pdf.embedFont(readFileSync("fonts/DejaVuSans-Bold.ttf"));
    const width = SHEET_W - 2 * 3 * MM;

    const short = fitHeader("Koszulka Biała", font, width);
    expect(short.size).toBe(9.5);
    expect(short.lines).toHaveLength(1);

    const long = fitHeader(
      "Spodnie Dresowe Męskie Szare Z Białymi Lampasami Rozmiar L Stan Bardzo Dobry " +
        "Materiałowe Wykonanie Bez Wad Kieszenie Boczne Ściągacze Na Nogawkach " +
        "Kolekcja Jesień Zima Okazja Dla Kolekcjonerów",
      font,
      width,
    );
    expect(long.lines.length).toBeLessThanOrEqual(3);
    expect(long.size).toBeLessThan(9.5);

    // Every wrapped line really fits the column.
    for (const line of long.lines) {
      expect(font.widthOfTextAtSize(line, long.size)).toBeLessThanOrEqual(width);
    }
  });

  it("łamie pojedyncze słowo szersze niż kolumna", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont((await import("pdf-lib")).StandardFonts.Helvetica);
    const lines = wrapText("A".repeat(200), font, 9.5, 100);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(font.widthOfTextAtSize(line, 9.5)).toBeLessThanOrEqual(100);
  });
});

describe("maska", () => {
  /** Paints horizontal bands of ink into a blank page. */
  const page = (w: number, h: number, bands: [number, number, number, number][]) => {
    const gray = new Uint8Array(w * h).fill(255);
    for (const [x0, y0, bw, bh] of bands) {
      for (let y = y0; y < y0 + bh; y++) gray.fill(0, y * w + x0, y * w + x0 + bw);
    }
    return buildMask(gray, w, h, 150);
  };

  it("odcina jednowierszową nazwę oferty z góry", () => {
    // 1275 x 1650 px page: a 15 px band at the top, the label 300 px lower.
    const mask = page(1275, 1650, [
      [60, 40, 700, 15],
      [100, 300, 600, 900],
    ]);
    trimTopTitleBand(mask);
    expect(mask.ink.subarray(40 * 1275, 56 * 1275).some((v) => v === 1)).toBe(false);
    expect(mask.ink.subarray(300 * 1275, 301 * 1275).some((v) => v === 1)).toBe(true);
  });

  it("nie rusza pasa wyższego niż 0,35 cala", () => {
    // 60 px is above the 52.5 px limit, so it is label content, not a name.
    const mask = page(1275, 1650, [[60, 40, 700, 60]]);
    trimTopTitleBand(mask);
    expect(mask.ink.subarray(40 * 1275, 100 * 1275).some((v) => v === 1)).toBe(true);
  });

  it("rozpoznaje dwie kopie obok siebie i bierze lewą", () => {
    const mask = page(1275, 1650, [
      [60, 200, 500, 800],
      [700, 200, 500, 800],
    ]);
    const { column, duplicates } = segmentColumns(mask);
    expect(duplicates).toBe(true);
    expect(column.x0).toBe(60);
    expect(column.x1).toBe(559);
  });

  it("nie bierze za duplikaty pasm o różnej zawartości tuszu", () => {
    const mask = page(1275, 1650, [
      [60, 200, 500, 800],
      [700, 200, 500, 80],
    ]);
    const { column, duplicates } = segmentColumns(mask);
    expect(duplicates).toBe(false);
    // Both bands belong to one label, so the column spans them.
    expect(column.x0).toBe(60);
    expect(column.x1).toBe(1199);
  });

  it("odrzuca pasma węższe niż 0,35 cala", () => {
    const mask = page(1275, 1650, [
      [60, 200, 20, 800],
      [400, 200, 500, 800],
    ]);
    const { column } = segmentColumns(mask);
    expect(column.x0).toBe(400);
  });
});

describe("słownik polskich znaków", () => {
  it("podmienia całe słowa, zachowując wielkość liter", () => {
    expect(fixDiacritics("Bluza Mska")).toBe("Bluza Męska");
    expect(fixDiacritics("BLUZA MSKA")).toBe("BLUZA MĘSKA");
    expect(fixDiacritics("Rowo-Biaa sukienka")).toBe("Różowo-Biała sukienka");
  });

  it("nie rusza słów spoza słownika", () => {
    expect(fixDiacritics("Maskotka i maskarada")).toBe("Maskotka i maskarada");
  });
});
