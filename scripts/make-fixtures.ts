/**
 * Builds the fixture PDFs used by the test suite. They imitate the seven
 * carrier layouts the pipeline was validated against: framed labels, a GLS
 * sheet whose instruction block is larger than the label, a frameless sparse
 * Poczta Polska label, a duplicate-copies sheet, a cross-border two-part sheet,
 * a sideways label and a locker QR page.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";

const A4: [number, number] = [595.28, 841.89];
const LETTER: [number, number] = [612, 792];
const LANDSCAPE_A4: [number, number] = [841.89, 595.28];
const BLACK = rgb(0, 0, 0);

/** Deterministic PRNG so fixtures are byte-stable between runs. */
function prng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * A GS1-128-like bar pattern: strict alternation of bars and spaces, each one
 * to four modules wide. Real linear barcodes never leave a wide white gap, and
 * a generator that does produces fixtures that lie — a gap over ~5 pt splits
 * the code into separate ink bands during column segmentation.
 */
function barcode(page: PDFPage, x: number, y: number, w: number, h: number, seed: number) {
  const rand = prng(seed);
  const modules = 211; // a 20-digit GS1-128 symbol
  const unit = w / modules;
  let cx = x;
  let dark = true;
  while (cx < x + w) {
    const run = Math.min(1 + Math.floor(rand() * 4), (x + w - cx) / unit) * unit;
    if (dark && run > 0) page.drawRectangle({ x: cx, y, width: run, height: h, color: BLACK });
    cx += run;
    dark = !dark;
  }
}

function qr(page: PDFPage, x: number, y: number, size: number, seed: number) {
  const rand = prng(seed);
  const modules = 25;
  const m = size / modules;
  for (let i = 0; i < modules; i++) {
    for (let j = 0; j < modules; j++) {
      if (rand() > 0.5) {
        page.drawRectangle({ x: x + i * m, y: y + j * m, width: m, height: m, color: BLACK });
      }
    }
  }
  // Finder patterns.
  for (const [fx, fy] of [
    [0, size - 7 * m],
    [size - 7 * m, size - 7 * m],
    [0, 0],
  ]) {
    page.drawRectangle({ x: x + fx, y: y + fy, width: 7 * m, height: 7 * m, color: BLACK });
    page.drawRectangle({ x: x + fx + m, y: y + fy + m, width: 5 * m, height: 5 * m, color: rgb(1, 1, 1) });
    page.drawRectangle({ x: x + fx + 2 * m, y: y + fy + 2 * m, width: 3 * m, height: 3 * m, color: BLACK });
  }
}

function frame(page: PDFPage, x: number, y: number, w: number, h: number) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: 1.2 });
}

function rule(page: PDFPage, x: number, y: number, w: number) {
  page.drawRectangle({ x, y, width: w, height: 1.2, color: BLACK });
}

type Ctx = { font: PDFFont; bold: PDFFont };

function text(page: PDFPage, ctx: Ctx, str: string, x: number, y: number, size = 8, bold = false) {
  page.drawText(str, { x, y, size, font: bold ? ctx.bold : ctx.font, color: BLACK });
}

/** A generic framed carrier label: header bar, address block, barcode, QR. */
function drawLabel(page: PDFPage, ctx: Ctx, x: number, y: number, w: number, h: number, carrier: string, seed: number) {
  frame(page, x, y, w, h);
  const pad = 10;
  text(page, ctx, carrier, x + pad, y + h - 22, 16, true);
  rule(page, x, y + h - 30, w);
  text(page, ctx, "Nadawca: Sklep Vinted, ul. Testowa 1, 00-001 Warszawa", x + pad, y + h - 46, 7);
  text(page, ctx, "Odbiorca:", x + pad, y + h - 62, 7);
  text(page, ctx, "Jan Kowalski", x + pad, y + h - 74, 11, true);
  text(page, ctx, "ul. Przykladowa 12/3", x + pad, y + h - 88, 9);
  text(page, ctx, "31-234 Krakow", x + pad, y + h - 100, 9);
  text(page, ctx, "tel. 600 100 200", x + pad, y + h - 112, 8);
  text(page, ctx, `${carrier} Track-ID`, x + pad, y + h - 130, 8);
  rule(page, x, y + h - 140, w);
  qr(page, x + w - 90, y + 24, 72, seed + 5);
  barcode(page, x + pad, y + 40, w - 110, 52, seed);
  text(page, ctx, "0059 2213 4457 8890", x + pad, y + 26, 9);
}

async function doc(): Promise<{ pdf: PDFDocument; ctx: Ctx }> {
  const pdf = await PDFDocument.create();
  const ctx: Ctx = {
    font: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  return { pdf, ctx };
}

async function save(name: string, pdf: PDFDocument) {
  writeFileSync(`fixtures/${name}`, await pdf.save());
  console.log("fixtures/" + name);
}

async function main() {
  mkdirSync("fixtures", { recursive: true });

  // 1. InPost, framed, upright, one-line offer name above.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(A4);
    text(page, ctx, "Szorty Sportowe Czarne Baggy Z Biaymi Lampasami Damskie", 40, 800, 11, true);
    drawLabel(page, ctx, 90, 300, 283, 425, "InPost", 11);
    await save("inpost.pdf", pdf);
  }

  // 2. GLS: the instruction block is taller and wider than the label, so a
  //    bounding-box-area criterion would pick it.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(LETTER);
    text(page, ctx, "Kurtka Materiaowe Zimowa", 40, 762, 11, true);
    drawLabel(page, ctx, 30, 300, 240, 380, "GLS", 23);
    // The instruction block is both taller and wider than the label.
    frame(page, 330, 250, 250, 470);
    // Mostly whitespace inside a big frame, the way a real instruction panel
    // looks: bigger than the label but far less ink, so step 5 must pick by
    // ink count and not by bounding-box area.
    text(page, ctx, "INSTRUKCJE", 340, 690, 10, true);
    for (let i = 0; i < 12; i++) {
      text(page, ctx, "Wydrukuj te etykiete i naklej ja na przesylke.", 340, 650 - i * 30, 8);
    }
    await save("gls.pdf", pdf);
  }

  // 3. Poczta Polska: no frame, elements far apart, barcode at the very edge.
  //    Content volume matches a real e-nadanie label — the sparse fallback in
  //    step 6 is decided on the ratio of the densest block to the column's ink,
  //    so an unrealistically empty fixture would not exercise it honestly.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(A4);
    text(page, ctx, "Bluza Mska Rowe", 40, 800, 11, true);
    text(page, ctx, "POCZTA POLSKA", 100, 700, 18, true);
    text(page, ctx, "Przesylka biznesowa polecona ekonomiczna", 100, 684, 8);
    const sender = [
      "NADAWCA:",
      "Sklep Odziezowy Vinted Sp. z o.o.",
      "ul. Marszalkowska 142 lok. 21",
      "00-061 Warszawa",
      "NIP 5252445566, tel. 22 100 20 30",
    ];
    sender.forEach((line, i) => text(page, ctx, line, 100, 660 - i * 11, 8));
    const receiver = [
      "Jan Kowalski",
      "ul. Przykladowa 12/3",
      "31-234 Krakow",
      "tel. 600 100 200",
      "jan.kowalski@example.com",
    ];
    receiver.forEach((line, i) => text(page, ctx, line, 100, 560 - i * 14, i === 0 ? 13 : 10, i === 0));
    const meta = [
      "Numer nadania: PX 0059 2213 4457 8890 PL",
      "Masa: 0,85 kg    Gabaryt: A    Pobranie: brak",
      "Data nadania: 12.05.2025    Placowka: UP Warszawa 12",
      "Zwrot do nadawcy po 14 dniach od awizacji",
      "Reklamacje: infolinia 801 333 444",
      "Nr referencyjny sprzedajacego: VIN-88213-KRK",
      "Zadeklarowana wartosc: 120,00 PLN",
    ];
    meta.forEach((line, i) => text(page, ctx, line, 100, 470 - i * 11, 7));
    qr(page, 330, 640, 70, 31);
    barcode(page, 100, 300, 300, 55, 37);
    text(page, ctx, "0059 2213 4457 8890", 100, 288, 9);
    await save("poczta.pdf", pdf);
  }

  // 4. Two identical copies side by side, separated by a cut line and a
  //    vertical instruction strip.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(A4);
    text(page, ctx, "Spodnie Dugim Rkawem", 40, 800, 11, true);
    drawLabel(page, ctx, 30, 280, 240, 420, "DPD", 41);
    drawLabel(page, ctx, 330, 280, 240, 420, "DPD", 41);
    for (let y = 280; y < 700; y += 6) {
      page.drawRectangle({ x: 300, y, width: 0.8, height: 3, color: BLACK });
    }
    page.drawText("Wydrukuj te etykiete i naklej ja na przesylke", {
      x: 288, y: 300, size: 6, font: ctx.font, rotate: degrees(90), color: BLACK,
    });
    await save("duplicates.pdf", pdf);
  }

  // 5. Cross-border sheet: InPost to the border, Zásilkovna for the last mile.
  //    Aspect around 1:3.4, so it must be split at the internal divider.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(A4);
    text(page, ctx, "Sukienka w Krat", 40, 800, 11, true);
    const x = 160;
    const w = 220;
    const h = 374;
    drawLabel(page, ctx, x, 380, w, h, "InPost", 53);
    drawLabel(page, ctx, x, 4, w, h, "Zasilkovna", 59);
    rule(page, x, 378, w);
    await save("foreign.pdf", pdf);
  }

  // 6. Sideways label (rotated 90 degrees on the sheet).
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(A4);
    text(page, ctx, "Koszula Biae w Kratk", 40, 800, 11, true);
    const embedded = await pdf.embedPage((await (async () => {
      const inner = await PDFDocument.create();
      const ip = inner.addPage([283, 425]);
      const ictx: Ctx = {
        font: await inner.embedFont(StandardFonts.Helvetica),
        bold: await inner.embedFont(StandardFonts.HelveticaBold),
      };
      drawLabel(ip, ictx, 0, 0, 283, 425, "ORLEN PACZKA", 67);
      const bytes = await inner.save();
      const reloaded = await PDFDocument.load(bytes);
      return reloaded.getPage(0);
    })()));
    page.drawPage(embedded, { x: 480, y: 200, rotate: degrees(90) });
    await save("rotated.pdf", pdf);
  }

  // 7. Locker QR page: a QR block and very little text, no barcode.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(A4);
    text(page, ctx, "Torebka Panterk", 40, 800, 11, true);
    frame(page, 150, 400, 300, 300);
    text(page, ctx, "Kod do automatu", 170, 670, 12, true);
    qr(page, 200, 440, 200, 71);
    await save("qr-only.pdf", pdf);
  }

  // 8. Poczta Polska on a landscape sheet: no frame, a dense barcode sitting
  //    far from everything else, and the label's own sender block starting
  //    inside the top 15% of the page. Both traps of this layout are real:
  //    the barcode alone holds more than half the page's ink, and the "offer
  //    name" trim eats the sender block unless it is bounded by the text layer.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(LANDSCAPE_A4);
    const h = LANDSCAPE_A4[1];
    text(page, ctx, "Spodnie Baggy W Krat Musztardowe Szerokie Damskie", 16, h - 16, 12, true);

    const sender = [
      "Vinted Go UAB w imieniu i na r",
      "Maria Kluba",
      "Aleksandra Fredry 32",
      "30-605 Krakow",
      "F eCommerce, Max masa 1kg",
    ];
    sender.forEach((line, i) => text(page, ctx, line, 50, h - 62 - i * 11, 5));
    text(page, ctx, "Umowa nr ID: 437317/W Karta: 778991 z", 268, h - 62, 5);
    text(page, ctx, "Poczta Polska S.A.", 292, h - 73, 5);

    text(page, ctx, "R", 246, h - 158, 15, true);
    barcode(page, 272, h - 172, 160, 32, 101);
    text(page, ctx, "(00) 55900773 0 49411673 9", 274, h - 184, 5);

    text(page, ctx, "VSPV", 55, h - 240, 20, true);
    text(page, ctx, "Emilia Firlej", 196, h - 226, 6, true);
    text(page, ctx, "Zaokopowa 4/6 , Kod do furtki i klatki: 78 kluczyk 6882 m:78", 196, h - 240, 6, true);
    text(page, ctx, "03-424 WARSZAWA", 196, h - 254, 6, true);
    await save("poczta-landscape.pdf", pdf);
  }

  // 9. Frameless label whose parts sit close enough for the dilation to join
  //    them into one block. The fallback of step 6 never fires, so the margin
  //    cannot be decided by that flag — only by the absence of a frame.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(LANDSCAPE_A4);
    const h = LANDSCAPE_A4[1];
    text(page, ctx, "Spodnie Dresowe Szare Baggy Szerokie Mskie", 16, h - 16, 12, true);
    text(page, ctx, "R", 150, h - 150, 15, true);
    barcode(page, 176, h - 164, 190, 34, 107);
    text(page, ctx, "(00) 55900773 0 49234386 1", 180, h - 176, 5);
    text(page, ctx, "F", 120, h - 196, 6);
    text(page, ctx, "Ewa Cudek Petryshyn", 146, h - 214, 13, true);
    text(page, ctx, "Jagiellonska 23", 146, h - 232, 13, true);
    text(page, ctx, "32-410 DOBCZYCE", 146, h - 250, 13, true);
    await save("poczta-compact.pdf", pdf);
  }

  // 10. Two-line offer name — the case step 3's band height test misses and only
  //    the text-layer limiter catches.
  {
    const { pdf, ctx } = await doc();
    const page = pdf.addPage(A4);
    text(page, ctx, "Spodnie Dresowe Mskie Szare Z Biaymi Lampasami Rozmiar L", 40, 806, 11, true);
    text(page, ctx, "Stan Bardzo Dobry Materiaowe Wykonanie", 40, 790, 11, true);
    drawLabel(page, ctx, 90, 330, 283, 425, "InPost", 83);
    await save("two-line-title.pdf", pdf);
  }
}

main();
