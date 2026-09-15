import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { PageResult } from "../lib/analyze";

const pdf = readFileSync("fixtures/inpost.pdf");

/**
 * Once the stream is open the status line is already sent, so a failure has to
 * travel inside the body. Reaching that path for real needs a document that
 * breaks part-way through analysis, which is why the analyzer is stubbed here:
 * what is under test is the route's plumbing, not the pipeline.
 */
describe("/api/analyze — błąd w trakcie strumienia", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/analyze");
    vi.unstubAllGlobals();
  });

  it("oddaje to, co zdążyło się policzyć, i dokleja linię błędu", async () => {
    vi.doMock("@/lib/analyze", () => ({
      async *analyzePages(): AsyncGenerator<PageResult> {
        yield { pageIndex: 0, pageCount: 3, items: [] };
        throw new Error("pdfium padł na stronie 2");
      },
    }));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array(pdf).slice().buffer, { status: 200 })),
    );

    const { POST } = await import("@/app/api/analyze/route");
    const response = await POST(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ sources: [{ url: "https://x.public.blob.vercel-storage.com/a.pdf" }] }),
      }),
    );

    // The response itself still succeeds — the failure is in the body.
    expect(response.status).toBe(200);
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; error?: string; pageCount?: number });

    expect(lines[0].type).toBe("page");
    expect(lines[0].pageCount).toBe(3);
    expect(lines.at(-1)?.type).toBe("error");
    expect(lines.at(-1)?.error).toContain("pdfium");
  });
});
