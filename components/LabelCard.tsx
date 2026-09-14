"use client";

import { useEffect, useRef } from "react";

import type { PagePreview } from "@/lib/client";
import type { AnalyzedItem, PtRect } from "@/lib/types";

export type CardState = AnalyzedItem & {
  include: boolean;
  /** True once the user has dragged the crop frame. */
  edited: boolean;
  /** Rotation the analyzer detected, so the preview can be turned by the delta. */
  detectedRotate: 0 | 90 | 180 | 270;
};

/**
 * Re-draws the thumbnail from the full-page preview after a manual crop, so the
 * card reflects the user's frame without another server round trip.
 */
function CanvasThumb({
  preview,
  crop,
  rotate,
}: {
  preview: PagePreview;
  crop: PtRect;
  rotate: 0 | 90 | 180 | 270;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const image = new Image();
    image.onload = () => {
      const k = image.width / preview.widthPt;
      const sx = crop.x * k;
      const sy = (preview.heightPt - crop.y - crop.h) * k;
      const sw = Math.max(1, crop.w * k);
      const sh = Math.max(1, crop.h * k);
      const swap = rotate === 90 || rotate === 270;
      element.width = Math.round(swap ? sh : sw);
      element.height = Math.round(swap ? sw : sh);
      const ctx = element.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, element.width, element.height);
      ctx.save();
      ctx.translate(element.width / 2, element.height / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.drawImage(image, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();
    };
    image.src = preview.png;
  }, [preview, crop.x, crop.y, crop.w, crop.h, rotate]);

  return <canvas ref={canvas} className="max-h-40 w-auto max-w-full object-contain" />;
}

export function LabelCard({
  item,
  preview,
  onToggle,
  onRotate,
  onTitle,
  onEditCrop,
}: {
  item: CardState;
  preview?: PagePreview;
  onToggle: () => void;
  onRotate: (delta: -90 | 90) => void;
  onTitle: (value: string) => void;
  onEditCrop: () => void;
}) {
  const lowConfidence = item.confidence < 0.8;
  // The server preview is already turned by the detected angle; CSS adds the rest.
  const cssRotation = (item.rotate - item.detectedRotate + 360) % 360;

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border bg-white p-3 ${
        lowConfidence ? "border-amber-500 ring-2 ring-amber-200" : "border-neutral-200"
      }`}
    >
      <div className="flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-neutral-100 p-2">
        {item.edited && preview ? (
          <CanvasThumb preview={preview} crop={item.crop} rotate={item.rotate} />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.previewPng}
            alt="Podgląd etykiety"
            className="max-h-40 w-auto max-w-full object-contain"
            style={cssRotation ? { transform: `rotate(${cssRotation}deg)` } : undefined}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 font-medium">
          <input type="checkbox" checked={item.include} onChange={onToggle} className="h-4 w-4" />
          drukuj
        </label>
        {item.carrier && (
          <span className="rounded-full bg-neutral-900 px-2 py-0.5 text-white">{item.carrier}</span>
        )}
        {item.kind === "qr-only" && (
          <span className="rounded-full bg-neutral-200 px-2 py-0.5">kod QR, nie naklejka</span>
        )}
        {item.splitOf && <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-900">2-częściowa</span>}
      </div>

      <div className="-mt-1 text-[11px] text-neutral-400">
        str. {item.pageIndex + 1} · pewność {(item.confidence * 100).toFixed(0)}%
      </div>

      <input
        value={item.titleFixed}
        onChange={(event) => onTitle(event.target.value)}
        placeholder="Nazwa produktu"
        className="w-full rounded-lg border border-neutral-300 px-2.5 py-1.5 text-sm"
      />

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onRotate(-90)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-sm"
          aria-label="Obróć w lewo"
        >
          ↺
        </button>
        <button
          type="button"
          onClick={() => onRotate(90)}
          className="rounded-lg border border-neutral-300 px-2.5 py-1 text-sm"
          aria-label="Obróć w prawo"
        >
          ↻
        </button>
        <button
          type="button"
          onClick={onEditCrop}
          className="ml-auto rounded-lg border border-neutral-300 px-2.5 py-1 text-sm"
        >
          Popraw kadr
        </button>
      </div>

      {item.splitOf && (
        <p className="rounded-lg bg-blue-50 px-2.5 py-2 text-xs text-blue-900">
          Etykieta dwuczęściowa, obie części naklej na tę samą paczkę, obok siebie.
        </p>
      )}
      {lowConfidence && item.notes.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg bg-amber-50 px-5 py-2 text-xs text-amber-900">
          {item.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
