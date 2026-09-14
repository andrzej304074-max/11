// The worker build ships without typings; it is only ever handed to pdf.js as
// an opaque module object via globalThis.pdfjsWorker.
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  const worker: { WorkerMessageHandler: unknown };
  export default worker;
}
