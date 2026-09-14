"use client";

import { upload } from "@vercel/blob/client";

import type { AnalyzedItem, GenerateItem } from "./types";

export type Source = { file: File; blobUrl?: string };

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

async function ensureUploaded(sources: Source[]): Promise<boolean> {
  if (!(await blobConfigured())) return false;
  try {
    for (const source of sources) {
      if (source.blobUrl) continue;
      const result = await upload(source.file.name, source.file, {
        access: "public",
        handleUploadUrl: "/api/blob/upload",
        contentType: "application/pdf",
      });
      source.blobUrl = result.url;
    }
    return true;
  } catch {
    for (const source of sources) source.blobUrl = undefined;
    return false;
  }
}

async function post(url: string, sources: Source[], extra: Record<string, unknown>, useBlob: boolean) {
  if (useBlob) {
    return fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
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
  return fetch(url, { method: "POST", body: form });
}

async function failure(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    return data.error ?? `Błąd ${response.status}`;
  } catch {
    return `Błąd ${response.status}`;
  }
}

export async function analyze(sources: Source[]): Promise<AnalyzedItem[]> {
  const useBlob = await ensureUploaded(sources);
  const response = await post("/api/analyze", sources, {}, useBlob);
  if (!response.ok) throw new Error(await failure(response));
  const data = (await response.json()) as { items: AnalyzedItem[] };
  return data.items;
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
