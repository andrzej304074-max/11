import { del } from "@vercel/blob";

import { normalizeRotation } from "./normalize";

export type SourceRef = { url?: string; name?: string };

/** Hard ceiling per file, mirroring what a 60 s lambda can chew through. */
const MAX_BYTES = 40 * 1024 * 1024;

async function fetchBlob(url: string): Promise<Uint8Array> {
  const parsed = new URL(url);
  // Only ever read back from Vercel Blob storage — never an arbitrary host.
  if (!/(^|\.)vercel-storage\.com$/.test(parsed.hostname) || parsed.protocol !== "https:") {
    throw new Error("Niedozwolony adres pliku");
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Nie udało się pobrać pliku (${response.status})`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) throw new Error("Plik jest za duży");
  return new Uint8Array(buffer);
}

export type RequestInput = {
  /** Page-rotation-normalized PDF bytes, in upload order. */
  files: Uint8Array[];
  names: string[];
  blobUrls: string[];
  body: Record<string, unknown>;
};

/**
 * Accepts either multipart/form-data (small uploads, curl) or JSON carrying
 * Vercel Blob URLs (the normal path — a function body caps out around 4.5 MB
 * and thirty labels weigh more than that).
 */
export async function readInput(request: Request): Promise<RequestInput> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const files: Uint8Array[] = [];
    const names: string[] = [];
    for (const entry of form.getAll("files")) {
      if (typeof entry === "string") continue;
      const bytes = new Uint8Array(await entry.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error("Plik jest za duży");
      files.push(await normalizeRotation(bytes));
      names.push(entry.name);
    }
    const body: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      if (typeof value === "string" && key !== "files") body[key] = value;
    }
    return { files, names, blobUrls: [], body };
  }

  const json = (await request.json()) as Record<string, unknown>;
  const sources = Array.isArray(json.sources) ? (json.sources as SourceRef[]) : [];
  const files: Uint8Array[] = [];
  const names: string[] = [];
  const blobUrls: string[] = [];
  for (const source of sources) {
    if (!source?.url) throw new Error("Brak adresu pliku");
    files.push(await normalizeRotation(await fetchBlob(source.url)));
    names.push(source.name ?? "");
    blobUrls.push(source.url);
  }
  return { files, names, blobUrls, body: json };
}

/** Best-effort removal of the uploaded originals; they hold third-party data. */
export async function discardBlobs(urls: string[]): Promise<void> {
  if (urls.length === 0 || !process.env.BLOB_READ_WRITE_TOKEN) return;
  try {
    await del(urls);
  } catch {
    // Deletion is best effort: the blobs also carry a short TTL.
  }
}
