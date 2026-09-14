"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PagePreview } from "@/lib/client";
import type { PtRect } from "@/lib/types";

type Handle = "move" | "nw" | "ne" | "sw" | "se";

/**
 * Manual crop correction: drags a frame over a full-page preview. The preview
 * is in image space (Y down), the crop in PDF points (Y up), so every read and
 * write flips the vertical axis.
 */
export function CropEditor({
  preview,
  crop,
  onChange,
  onClose,
}: {
  preview: PagePreview;
  crop: PtRect;
  onChange: (crop: PtRect) => void;
  onClose: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ handle: Handle; startX: number; startY: number; start: PtRect } | null>(null);

  const scale = useCallback(() => {
    const element = box.current;
    if (!element) return 1;
    return element.clientWidth / preview.widthPt;
  }, [preview.widthPt]);

  const onPointerDown = (handle: Handle) => (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDrag({ handle, startX: event.clientX, startY: event.clientY, start: crop });
  };

  useEffect(() => {
    if (!drag) return;
    const factor = scale();

    const move = (event: PointerEvent) => {
      const dx = (event.clientX - drag.startX) / factor;
      // Screen Y grows downwards, PDF Y grows upwards.
      const dy = -(event.clientY - drag.startY) / factor;
      const start = drag.start;
      let next: PtRect;
      switch (drag.handle) {
        case "move":
          next = { ...start, x: start.x + dx, y: start.y + dy };
          break;
        case "nw":
          next = { x: start.x + dx, y: start.y, w: start.w - dx, h: start.h + dy };
          break;
        case "ne":
          next = { x: start.x, y: start.y, w: start.w + dx, h: start.h + dy };
          break;
        case "sw":
          next = { x: start.x + dx, y: start.y + dy, w: start.w - dx, h: start.h - dy };
          break;
        default:
          next = { x: start.x, y: start.y + dy, w: start.w + dx, h: start.h - dy };
      }
      const minSize = 20;
      next.w = Math.max(minSize, next.w);
      next.h = Math.max(minSize, next.h);
      next.x = Math.min(Math.max(0, next.x), preview.widthPt - next.w);
      next.y = Math.min(Math.max(0, next.y), preview.heightPt - next.h);
      onChange(next);
    };
    const up = () => setDrag(null);

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, onChange, preview.heightPt, preview.widthPt, scale]);

  const style = {
    left: `${(crop.x / preview.widthPt) * 100}%`,
    width: `${(crop.w / preview.widthPt) * 100}%`,
    top: `${(1 - (crop.y + crop.h) / preview.heightPt) * 100}%`,
    height: `${(crop.h / preview.heightPt) * 100}%`,
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-full w-full max-w-lg overflow-auto rounded-xl bg-white p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Ręczna korekta kadru</h2>
          <button type="button" onClick={onClose} className="rounded border border-neutral-300 px-3 py-1 text-sm">
            Gotowe
          </button>
        </div>
        <div ref={box} className="relative select-none" style={{ aspectRatio: `${preview.widthPt} / ${preview.heightPt}` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.png} alt="Podgląd strony" className="absolute inset-0 h-full w-full" draggable={false} />
          <div
            className="absolute cursor-move border-2 border-blue-600 bg-blue-600/10"
            style={style}
            onPointerDown={onPointerDown("move")}
          >
            {(["nw", "ne", "sw", "se"] as const).map((handle) => (
              <span
                key={handle}
                onPointerDown={onPointerDown(handle)}
                className="absolute h-3 w-3 rounded-sm border border-white bg-blue-600"
                style={{
                  left: handle.endsWith("w") ? -6 : undefined,
                  right: handle.endsWith("e") ? -6 : undefined,
                  top: handle.startsWith("n") ? -6 : undefined,
                  bottom: handle.startsWith("s") ? -6 : undefined,
                  cursor: `${handle}-resize`,
                }}
              />
            ))}
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Przeciągnij ramkę lub jej narożniki. Miniatura karty odświeży się po zamknięciu.
        </p>
      </div>
    </div>
  );
}
