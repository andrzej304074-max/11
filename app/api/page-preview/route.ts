import { readInput } from "@/lib/input";
import { encodeGrayPng } from "@/lib/png";
import { downscale } from "@/lib/image";
import { DPI, loadPdf } from "@/lib/raster";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Renders one whole page for the manual crop editor. Kept as a separate,
 * on-demand call so the analyze response does not carry a full-page bitmap for
 * every page the user never touches.
 */
export async function POST(request: Request) {
  try {
    const { files, body } = await readInput(request);
    const pageIndex = Number(body.pageIndex ?? 0);
    const bytes = files[0];
    if (!bytes) return Response.json({ error: "Brak pliku" }, { status: 400 });

    const pdf = await loadPdf(bytes);
    try {
      const page = await pdf.renderPage(pageIndex);
      const bmp = downscale({ data: page.gray, width: page.width, height: page.height }, 560);
      return Response.json({
        png: `data:image/png;base64,${encodeGrayPng(bmp.data, bmp.width, bmp.height).toString("base64")}`,
        widthPt: page.widthPt,
        heightPt: page.heightPt,
        dpi: DPI,
      });
    } finally {
      pdf.destroy();
    }
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Podgląd nie powiódł się" },
      { status: 400 },
    );
  }
}
