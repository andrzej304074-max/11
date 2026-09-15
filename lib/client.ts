"use client";

import { upload } from "@vercel/blob/client";

import type { AnalyzedItem, GenerateItem } from "./types";

export type Source = { file: File; blobUrl?: string };

/** Which stage the run is in, so a stall is attributable on screen. */
export type Phase = "upload" | "analyze";

/**
 * Uploads straight to Vercel Blob when it is configured, and falls back to a
 * plain multipart POST otherwise (local development, small batches).
 */
let blobAvailable: Promise<boolean> | null = null;

function blobConfigured(): Promise<boolean> {
  blobAvailable ??= fetch("/api/blob/upload")
    .then((response) => (response.ok ? response.json() : { available: false }))
    .then((data: { available?: boolean }) => data.available === true)
    .catch(() => false);
  return blobAvailable;
}

/** Vercel Blob's client retries ten times with a growing backoff, so a rate
 *  limited or unhealthy store shows up as an upload that never settles. Past
 *  this point the multipart route is the better answer, even with its ~4.5 MB
 *  ceiling: a working upload beats an indefinite spinner. */
const UPLOAD_TIMEOUT_MS = 25_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error as Error);
      },
    );
  });
}

async function ensureUploaded(sources: Source[], onPhase?: (phase: Phase) => void): Promise<boolean> {
  if (!(await blobConfigured())) return false;
  try {
    for (const source of sources) {
      if (source.blobUrl) continue;
      onPhase?.("upload");
      const result = await withTimeout(
        upload(source.file.name, source.file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload",
          contentType: "application/pdf",
        }),
        UPLOAD_TIMEOUT_MS,
        "Przechowalnia plików nie odpowiada",
      );
      source.blobUrl = result.url;
    }
    return true;
  } catch {
    for (const source of sources) source.blobUrl = undefined;
    return false;
  }
}

async function post(
  url: string,
  sources: Source[],
  extra: Record<string, unknown>,
  useBlob: boolean,
  headers: Record<string, string> = {},
) {
  if (useBlob) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({
        sources: sources.map((source) => ({ url: source.blobUrl, name: source.file.name })),
        ...extra,
      }),
    });
  }
  const form = new FormData();
  for (const source of sources) form.append("files", source.file);
  for (const [key, value] of Object.entries(extra)) {
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  return fetch(url, { method: "POST", body: form, headers });
}

async function failure(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? `Błąd ${response.status}`;
  } catch {
    return `Błąd ${response.status}`;
  }
}

export type AnalyzeProgress = { done: number; total: number };

export type AnalyzeOptions = {
  onItems?: (items: AnalyzedItem[]) => void;
  onProgress?: (progress: AnalyzeProgress) => void;
  onPhase?: (phase: Phase) => void;
};

/** How many times a stream that dies mid-document may be resumed. */
const MAX_RESUMES = 3;

type StreamLine =
  | { type: "page"; fileIndex: number; pageIndex: number; pageCount: number; items: AnalyzedItem[] }
  | { type: "done" }
  | { type: "error"; error: string };

/** Reads an NDJSON body line by line as it arrives. */
async function* readLines(response: Response): AsyncGenerator<StreamLine> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Serwer nie zwrócił strumienia");
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n");
    while (cut >= 0) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);
      if (line) yield JSON.parse(line) as StreamLine;
      cut = buffer.indexOf("\n");
    }
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as StreamLine;
}

/**
 * Analyzes each file with a single streaming request, handing labels to
 * `onItems` as the server finds them.
 *
 * One request per file matters beyond tidiness: with Vercel Blob the server
 * fetches the upload for every request it serves, so splitting a document into
 * slices multiplied both the transfer and the parse by the number of slices.
 * If a stream dies part-way — a function hitting its duration ceiling, a
 * dropped connection — the run resumes from the next unprocessed page instead
 * of starting over.
 */
export async function analyze(
  sources: Source[],
  options: AnalyzeOptions = {},
): Promise<AnalyzedItem[]> {
  const { onItems, onProgress, onPhase } = options;
  const useBlob = await ensureUploaded(sources, onPhase);
  onPhase?.("analyze");

  const all: AnalyzedItem[] = [];
  const pageCounts = new Map<number, number>();
  // Page counts are unknown until the first page of a file comes back, so the
  // total starts as one page per file and sharpens from there.
  const lengthOf = (index: number) => pageCounts.get(index) ?? 1;

  let completed = 0;
  for (let fileIndex = 0; fileIndex < sources.length; fileIndex++) {
    let nextPage = 0;
    let pages = Infinity;
    let resumes = 0;

    while (nextPage < pages) {
      const response = await post(
        "/api/analyze",
        [sources[fileIndex]],
        { fileIndexBase: fileIndex, ...(nextPage > 0 ? { fromPage: nextPage } : {}) },
        useBlob,
        { accept: "application/x-ndjson" },
      );
      if (!response.ok) throw new Error(await failure(response));

      const startedAt = nextPage;
      let finished = false;
      let streamError: string | null = null;

      for await (const line of readLines(response)) {
        if (line.type === "error") {
          streamError = line.error;
          break;
        }
        if (line.type === "done") {
          finished = true;
          break;
        }
        pages = line.pageCount;
        pageCounts.set(fileIndex, pages);
        nextPage = line.pageIndex + 1;
        if (line.items.length) {
          all.push(...line.items);
          onItems?.(line.items);
        }
        let total = 0;
        for (let i = 0; i < sources.length; i++) total += lengthOf(i);
        onProgress?.({ done: completed + nextPage, total });
      }

      if (streamError) throw new Error(streamError);
      if (finished || nextPage >= pages) break;

      // The stream stopped early. Resume, but only while it keeps making
      // progress — otherwise a page that always fails would loop forever.
      if (nextPage <= startedAt || ++resumes > MAX_RESUMES) {
        throw new Error("Analiza przerwana — spróbuj ponownie lub podziel plik na mniejsze części");
      }
    }
    completed += lengthOf(fileIndex);
  }
  return all;
}

export async function generate(
  sources: Source[],
  items: GenerateItem[],
  withHeader: boolean,
): Promise<Blob> {
  // The previous run deleted the uploads, so re-upload if needed.
  const useBlob = await ensureUploaded(sources);
  const response = await post("/api/generate", sources, { items, withHeader }, useBlob);
  if (!response.ok) throw new Error(await failure(response));
  // The originals are deleted server side once the output exists.
  for (const source of sources) source.blobUrl = undefined;
  return response.blob();
}

export type PagePreview = { png: string; widthPt: number; heightPt: number };

export async function pagePreview(source: Source, pageIndex: number): Promise<PagePreview> {
  const useBlob = Boolean(source.blobUrl);
  const response = await post("/api/page-preview", [source], { pageIndex: String(pageIndex) }, useBlob);
  if (!response.ok) throw new Error(await failure(response));
  return (await response.json()) as PagePreview;
}

/** Drops the uploaded originals; they hold recipients' personal data. */
export async function cleanup(sources: Source[]): Promise<void> {
  const urls = sources.map((source) => source.blobUrl).filter(Boolean) as string[];
  if (urls.length === 0) return;
  await fetch("/api/blob/cleanup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ urls }),
    keepalive: true,
  }).catch(() => undefined);
}
