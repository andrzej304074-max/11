import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as analyze } from "../app/api/analyze/route";
import type { AnalyzedItem } from "../lib/types";

const pdf = readFileSync("fixtures/inpost.pdf");

/**
 * Stands in for Vercel Blob. The hostname has to pass the allowlist in
 * lib/input.ts, which is the whole point: this exercises the JSON request path
 * the browser really uses in production, not just the multipart fallback.
 */
function stubBlob(bytes: Uint8Array = pdf) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (!url.includes("vercel-storage.com")) throw new Error(`nieoczekiwany fetch: ${url}`);
      return new Response(new Uint8Array(bytes).slice().buffer, { status: 200 });
    }),
  );
}

const jsonRequest = (body: unknown) =>
  new Request("http://localhost/api/analyze", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const multipartRequest = (extra: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), "inpost.pdf");
  for (const [key, value] of Object.entries(extra)) form.append(key, value);
  return new Request("http://localhost/api/analyze", { method: "POST", body: form });
};

afterEach(() => vi.unstubAllGlobals());

describe("/api/analyze", () => {
  it("czyta pliki z przechowalni przez JSON", async () => {
    stubBlob();
    const response = await analyze(
      jsonRequest({ sources: [{ url: "https://x.public.blob.vercel-storage.com/a.pdf" }] }),
    );
    expect(response.status).toBe(200);
    const data = (await response.json()) as { items: AnalyzedItem[]; pageCount: number };
    expect(data.pageCount).toBe(1);
    expect(data.items).toHaveLength(1);
    expect(data.items[0].carrier).toBe("InPost");
  });

  it("respektuje zakres stron i bazowy indeks pliku", async () => {
    stubBlob();
    const response = await analyze(
      jsonRequest({
        sources: [{ url: "https://x.public.blob.vercel-storage.com/a.pdf" }],
        fileIndexBase: 3,
        fromPage: 0,
        pageCount: 5,
      }),
    );
    const data = (await response.json()) as { items: AnalyzedItem[]; pageCount: number };
    expect(data.items[0].fileIndex).toBe(3);
    expect(data.items[0].id).toMatch(/^f3-p0/);
    expect(data.pageCount).toBe(1);
  });

  it("zwraca pustą listę dla zakresu poza dokumentem, ale nadal podaje liczbę stron", async () => {
    stubBlob();
    const response = await analyze(
      jsonRequest({
        sources: [{ url: "https://x.public.blob.vercel-storage.com/a.pdf" }],
        fromPage: 5,
        pageCount: 5,
      }),
    );
    const data = (await response.json()) as { items: AnalyzedItem[]; pageCount: number };
    expect(data.items).toHaveLength(0);
    expect(data.pageCount).toBe(1);
  });

  it("obsługuje też multipart z parametrami zakresu jako tekstem", async () => {
    const response = await analyze(multipartRequest({ fileIndexBase: "2", fromPage: "0", pageCount: "5" }));
    const data = (await response.json()) as { items: AnalyzedItem[]; pageCount: number };
    expect(data.items[0].fileIndex).toBe(2);
    expect(data.pageCount).toBe(1);
  });

  it("strumieniuje wyniki strona po stronie", async () => {
    stubBlob();
    const response = await analyze(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ sources: [{ url: "https://x.public.blob.vercel-storage.com/a.pdf" }] }),
      }),
    );
    expect(response.headers.get("content-type")).toContain("application/x-ndjson");

    const text = await response.text();
    const lines = text.trim().split("\n").map((line) => JSON.parse(line));
    expect(lines.at(-1)).toEqual({ type: "done" });

    const pages = lines.filter((line) => line.type === "page");
    expect(pages).toHaveLength(1);
    expect(pages[0].pageIndex).toBe(0);
    expect(pages[0].pageCount).toBe(1);
    expect(pages[0].items[0].carrier).toBe("InPost");
  });

  it("uszkodzony plik odrzuca statusem, zanim strumien ruszy", async () => {
    stubBlob(new Uint8Array([1, 2, 3, 4]));
    const response = await analyze(
      new Request("http://localhost/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/x-ndjson" },
        body: JSON.stringify({ sources: [{ url: "https://x.public.blob.vercel-storage.com/a.pdf" }] }),
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("odrzuca adres spoza przechowalni", async () => {
    stubBlob();
    const response = await analyze(jsonRequest({ sources: [{ url: "https://example.com/a.pdf" }] }));
    expect(response.status).toBe(400);
  });
});
