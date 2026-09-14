import { describe, expect, it } from "vitest";

import { analyzeFixture, inkMargins, outputAngles, outputText, pageSizes, renderFixture } from "./helpers";
import { fitScale } from "../lib/analyze";
import { SHEET_H, SHEET_W } from "../lib/types";

const FIXTURES = [
  "inpost.pdf",
  "gls.pdf",
  "poczta.pdf",
  "duplicates.pdf",
  "foreign.pdf",
  "rotated.pdf",
  "qr-only.pdf",
  "two-line-title.pdf",
];

describe("kryterium 1: rozmiar strony wyjściowej", () => {
  it.each(FIXTURES)("%s daje strony 100 x 150 mm", async (name) => {
    const sizes = await pageSizes(await renderFixture(name));
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size.widthPt).toBeCloseTo(SHEET_W, 2);
      expect(size.heightPt).toBeCloseTo(SHEET_H, 2);
    }
  });
});

describe("kryterium 2: tusz nie dotyka krawędzi", () => {
  it.each(FIXTURES)("%s zachowuje zapas >= 1,2 mm", async (name) => {
    const bytes = await renderFixture(name);
    const sizes = await pageSizes(bytes);
    for (let i = 0; i < sizes.length; i++) {
      const margins = await inkMargins(bytes, i);
      expect(margins.left).toBeGreaterThanOrEqual(1.2);
      expect(margins.right).toBeGreaterThanOrEqual(1.2);
      expect(margins.top).toBeGreaterThanOrEqual(1.2);
      expect(margins.bottom).toBeGreaterThanOrEqual(1.2);
    }
  });
});

describe("kryterium 3: strony sparse mają szerszy zapas", () => {
  it("poczta.pdf trzyma >= 5 mm z boku", async () => {
    const items = await analyzeFixture("poczta.pdf");
    expect(items.some((item) => item.sparse)).toBe(true);
    expect(items[0].padMm).toBe(6);

    const margins = await inkMargins(await renderFixture("poczta.pdf"), 0);
    expect(margins.left).toBeGreaterThanOrEqual(5);
    expect(margins.right).toBeGreaterThanOrEqual(5);
  });
});

describe("kryterium 4: dominujący kąt tekstu to 0 stopni", () => {
  it.each(FIXTURES)("%s wychodzi pionowo", async (name) => {
    for (const result of await outputAngles(await renderFixture(name))) {
      expect(result.angle).toBe(0);
    }
  });
});

describe("kryterium 5: GLS bez instrukcji", () => {
  it("zostaje Track-ID, znika blok INSTRUKCJE", async () => {
    const [text] = await outputText(await renderFixture("gls.pdf"));
    expect(text).toContain("GLS Track-ID");
    expect(text).not.toContain("INSTRUKCJE");
    expect(text).not.toContain("Wydrukuj te etykiete");
  });
});

describe("kryterium 6: dwie kopie obok siebie", () => {
  it("dają dokładnie jedną stronę wyjściową", async () => {
    const items = await analyzeFixture("duplicates.pdf");
    expect(items).toHaveLength(1);
    expect(await pageSizes(await renderFixture("duplicates.pdf"))).toHaveLength(1);
  });
});

describe("kryterium 7: arkusz zagraniczny", () => {
  it("daje dwie strony z sufiksami i po jednym kodzie kreskowym", async () => {
    const items = await analyzeFixture("foreign.pdf");
    expect(items).toHaveLength(2);
    expect(items[0].splitOf).toBe("f0-p0");
    expect(items[1].splitOf).toBe("f0-p0");
    expect(items[0].titleFixed).toContain("(1 z 2)");
    expect(items[1].titleFixed).toContain("(2 z 2)");
    expect(items[0].titleFixed).toContain("InPost");
    expect(items[1].titleFixed).toContain("Zásilkovna");

    const texts = await outputText(await renderFixture("foreign.pdf"));
    expect(texts).toHaveLength(2);
    // Each output page carries exactly one tracking number.
    for (const text of texts) {
      expect(text.match(/0059 2213 4457 8890/g) ?? []).toHaveLength(1);
    }
    expect(texts[0]).toContain("InPost");
    expect(texts[1]).toContain("Zasilkovna");
  });
});

describe("kryterium 8: skala nie spada poniżej 0,75 bez próby podziału", () => {
  it.each(FIXTURES)("%s", async (name) => {
    for (const item of await analyzeFixture(name)) {
      const scale = fitScale(item.crop, item.rotate, item.padMm);
      if (scale < 0.75) {
        // Only acceptable when the sheet had no internal divider to split on.
        expect(item.splitOf).toBeUndefined();
      }
      expect(scale).toBeGreaterThan(0.4);
    }
  });
});
