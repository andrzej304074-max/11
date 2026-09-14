import { NextResponse } from "next/server";

import { analyzeFile } from "@/lib/analyze";
import { readInput } from "@/lib/input";

export const runtime = "nodejs";
export const maxDuration = 60;

const number = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const { files, body } = await readInput(request);
    if (files.length === 0) {
      return NextResponse.json({ error: "Nie przesłano żadnego pliku PDF" }, { status: 400 });
    }

    // The client walks a long document in slices so it can show labels as they
    // are found; `fileIndexBase` keeps the ids stable across those requests.
    const base = number(body.fileIndexBase) ?? 0;
    const range = { from: number(body.fromPage), count: number(body.pageCount) };

    const items = [];
    let pageCount = 0;
    for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
      const result = await analyzeFile(base + fileIndex, files[fileIndex], range);
      items.push(...result.items);
      pageCount = result.pageCount;
      // Release the source buffer before the next file.
      files[fileIndex] = new Uint8Array(0);
    }

    // Never log page content, names or addresses — counts and timings only.
    console.log(`analyze: ${files.length} plik(ów), ${items.length} etykiet, ${Date.now() - started} ms`);
    return NextResponse.json({ items, pageCount });
  } catch (error) {
    console.error("analyze failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analiza nie powiodła się" },
      { status: 400 },
    );
  }
}
