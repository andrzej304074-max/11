import { discardBlobs } from "@/lib/input";

export const runtime = "nodejs";

/** Called when the user clears the queue without generating anything. */
export async function POST(request: Request) {
  const { urls } = (await request.json()) as { urls?: string[] };
  await discardBlobs(Array.isArray(urls) ? urls : []);
  return Response.json({ ok: true });
}
