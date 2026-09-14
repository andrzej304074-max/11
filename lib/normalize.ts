import { PDFDocument, degrees } from "pdf-lib";

/**
 * pdfium and pdf.js honour a page's /Rotate entry, pdf-lib's page coordinate
 * space does not. Baking the rotation into the content once, up front, keeps
 * the crop rectangles produced by the analyzer valid when the same file is
 * re-opened by the generator. Files without rotated pages are returned as-is.
 */
export async function normalizeRotation(bytes: Uint8Array): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const needsWork = src.getPages().some((page) => ((page.getRotation().angle % 360) + 360) % 360 !== 0);
  if (!needsWork) return bytes;

  const out = await PDFDocument.create();
  for (const page of src.getPages()) {
    const angle = (((page.getRotation().angle % 360) + 360) % 360) as 0 | 90 | 180 | 270;
    const { width, height } = page.getSize();
    const embedded = await out.embedPage(page);
    const swap = angle === 90 || angle === 270;
    const target = out.addPage([swap ? height : width, swap ? width : height]);

    // /Rotate turns the page clockwise for display; undo it by drawing the
    // content with the matching counter-clockwise anchor.
    if (angle === 0) target.drawPage(embedded, { x: 0, y: 0 });
    else if (angle === 90) target.drawPage(embedded, { x: height, y: 0, rotate: degrees(90) });
    else if (angle === 180) target.drawPage(embedded, { x: width, y: height, rotate: degrees(180) });
    else target.drawPage(embedded, { x: 0, y: width, rotate: degrees(270) });
  }
  return out.save();
}
