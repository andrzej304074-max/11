import { NextResponse } from "next/server";

import { analyzeFile } from "@/lib/analyze";
import { readInput } from "@/lib/input";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const { files } = await readInput(request);
    if (files.length === 0) {
      return NextResponse.json({ error: "Nie przesłano żadnego pliku PDF" }, { status: 400 });
    }

    const items = [];
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      items.push(...(await analyzeFile(fileIndex, files[fileIndex])));
      // Release the source buffer before the next file.
      files[fileIndex] = new Uint8Array(0);
    }

    // Never log page content, names or addresses — counts and timings only.
    console.log(`analyze: ${files.length} plik(ów), ${items.length} etykiet, ${Date.now() - started} ms`);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("analyze failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analiza nie powiodła się" },
      { status: 400 },
    );
  }
}
