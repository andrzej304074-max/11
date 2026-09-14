import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Issues a signed, single-use token so the browser uploads straight to Vercel
 * Blob. A function body is capped near 4.5 MB, which thirty labels exceed.
 */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["application/pdf"],
        maximumSizeInBytes: 40 * 1024 * 1024,
        addRandomSuffix: true,
        // Short-lived: the objects are deleted as soon as the output is built.
        cacheControlMaxAge: 60,
      }),
      onUploadCompleted: async () => {
        // No bookkeeping: nothing about the file's content is recorded.
      },
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Upload nie powiódł się" },
      { status: 400 },
    );
  }
}
