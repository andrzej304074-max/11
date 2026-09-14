"use client";

/**
 * Sends the generated PDF to the browser's print dialog without a round trip
 * through the Downloads folder. The file is handed to a hidden iframe, which is
 * what lets the viewer keep the PDF's own page size (100 x 150 mm) instead of
 * inheriting the page's CSS box.
 *
 * The object URL has to outlive the dialog — the dialog is modal but the print
 * call returns immediately in some browsers — so cleanup is deferred rather
 * than immediate.
 */
export function printPdf(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    frame.remove();
    URL.revokeObjectURL(url);
  };

  frame.onload = () => {
    try {
      const view = frame.contentWindow;
      if (!view) throw new Error("brak okna podglądu");
      view.focus();
      view.print();
    } catch {
      // Some browsers refuse to drive a PDF viewer from script; opening the
      // file in a tab still gets the user to their own print dialog.
      window.open(url, "_blank", "noopener");
    }
    // Long enough for the dialog to read the document, on any browser.
    window.setTimeout(cleanup, 120_000);
  };

  frame.onerror = cleanup;
  frame.src = url;
  document.body.appendChild(frame);
}
