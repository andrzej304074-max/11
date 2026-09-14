import { PDFiumLibrary } from "@hyzyla/pdfium";

export const DPI = 150;

export type GrayPage = {
  /** One byte of luminance per pixel, row-major, origin top-left. */
  gray: Uint8Array;
  width: number;
  height: number;
  /** Page size in PDF points. */
  widthPt: number;
  heightPt: number;
};

let libraryPromise: Promise<Awaited<ReturnType<typeof PDFiumLibrary.init>>> | null = null;

/** pdfium's WASM module is expensive to boot; keep one per lambda instance. */
export function getLibrary() {
  if (!libraryPromise) libraryPromise = PDFiumLibrary.init();
  return libraryPromise;
}

export type LoadedPdf = {
  pageCount: number;
  /** Rasterize one page to grayscale at `dpi`. */
  renderPage(pageIndex: number, dpi?: number): Promise<GrayPage>;
  /** Page size in PDF points without rasterizing. */
  pageSize(pageIndex: number): { widthPt: number; heightPt: number };
  destroy(): void;
};

export async function loadPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const library = await getLibrary();
  const doc = await library.loadDocument(bytes);

  return {
    pageCount: doc.getPageCount(),
    pageSize(pageIndex: number) {
      const page = doc.getPage(pageIndex);
      const { originalWidth, originalHeight } = page.getOriginalSize();
      return { widthPt: originalWidth, heightPt: originalHeight };
    },
    async renderPage(pageIndex: number, dpi = DPI): Promise<GrayPage> {
      const page = doc.getPage(pageIndex);
      const { originalWidth, originalHeight } = page.getOriginalSize();
      const render = await page.render({
        scale: dpi / 72,
        colorSpace: "Gray",
        render: "bitmap",
      });
      const { width, height, data } = render;
      // pdfium pads rows to a 4-byte stride for its 8bpp bitmaps.
      const stride = Math.floor(data.length / height);
      let gray: Uint8Array;
      if (stride === width) {
        gray = data instanceof Uint8Array ? data : new Uint8Array(data);
      } else {
        gray = new Uint8Array(width * height);
        for (let y = 0; y < height; y++) {
          gray.set(data.subarray(y * stride, y * stride + width), y * width);
        }
      }
      return { gray, width, height, widthPt: originalWidth, heightPt: originalHeight };
    },
    destroy() {
      doc.destroy();
    },
  };
}
