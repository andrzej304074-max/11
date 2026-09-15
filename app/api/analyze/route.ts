import { setImmediate } from "node:timers/promises";

import { NextResponse } from "next/server";

import { analyzePages } from "@/lib/analyze";
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

    // `fileIndexBase` keeps item ids stable when the client sends one file per
    // request; the range lets it resume a stream that was cut short.
    const base = number(body.fileIndexBase) ?? 0;
    const range = { from: number(body.fromPage), count: number(body.pageCount) };

    /**
     * Streaming is the default for the browser: one fetch, one parse of the
     * document, and labels on screen as they are found. Requesting a plain JSON
     * response (curl, tests) collects the same results instead.
     */
    const wantsStream = (request.headers.get("accept") ?? "").includes("application/x-ndjson");

    if (!wantsStream) {
      const items = [];
      let pageCount = 0;
      for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
        for await (const page of analyzePages(base + fileIndex, files[fileIndex], range)) {
          items.push(...page.items);
          pageCount = page.pageCount;
        }
        files[fileIndex] = new Uint8Array(0);
      }
      console.log(`analyze: ${files.length} plik(ów), ${items.length} etykiet, ${Date.now() - started} ms`);
      return NextResponse.json({ items, pageCount });
    }

    const encoder = new TextEncoder();
    let labels = 0;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: unknown) =>
          controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
        try {
          for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
            for await (const page of analyzePages(base + fileIndex, files[fileIndex], range)) {
              labels += page.items.length;
              send({ type: "page", fileIndex: base + fileIndex, ...page });
              // Analysis is CPU-bound and its awaits only resolve microtasks,
              // which never lets Node flush the socket. Without handing the
              // event loop back here the whole stream lands in one burst at the
              // end, which is exactly what streaming was meant to avoid.
              await setImmediate();
            }
            // Release the source buffer before the next file.
            files[fileIndex] = new Uint8Array(0);
          }
          send({ type: "done" });
        } catch (error) {
          // The status line is long gone by now, so failures travel in-band.
          send({
            type: "error",
            error: error instanceof Error ? error.message : "Analiza nie powiodła się",
          });
        } finally {
          // Never log page content, names or addresses — counts and timings only.
          console.log(`analyze: ${files.length} plik(ów), ${labels} etykiet, ${Date.now() - started} ms`);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "cache-control": "no-store",
        // Proxies must not sit on the chunks and hand them over all at once.
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("analyze failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Analiza nie powiodła się" },
      { status: 400 },
    );
  }
}
