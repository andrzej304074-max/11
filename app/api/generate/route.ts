import { buildOutput } from "@/lib/generate";
import { discardBlobs, readInput } from "@/lib/input";
import type { GenerateItem } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const started = Date.now();
  let blobUrls: string[] = [];
  try {
    const { files, blobUrls: urls, body } = await readInput(request);
    blobUrls = urls;

    const rawItems = typeof body.items === "string" ? JSON.parse(body.items) : body.items;
    const items = (rawItems ?? []) as GenerateItem[];
    if (!Array.isArray(items) || items.length === 0) {
      return Response.json({ error: "Brak pozycji do wygenerowania" }, { status: 400 });
    }
    const withHeader = body.withHeader === true || body.withHeader === "true";

    const pdf = await buildOutput(files, items, { withHeader });
    const selected = items.filter((item) => item.include).length;
    console.log(`generate: ${selected} naklejek, ${Date.now() - started} ms`);

    return new Response(pdf as BodyInit, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'attachment; filename="etykiety-100x150.pdf"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    console.error("generate failed", error instanceof Error ? error.message : "unknown");
    return Response.json(
      { error: error instanceof Error ? error.message : "Generowanie nie powiodło się" },
      { status: 400 },
    );
  } finally {
    // The uploaded originals carry recipients' personal data; drop them now.
    await discardBlobs(blobUrls);
  }
}
