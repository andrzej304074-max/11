import type { PxRect } from "./types";

export type Bitmap = { data: Uint8Array; width: number; height: number };

export function cropGray(gray: Uint8Array, width: number, rect: PxRect): Bitmap {
  const out = new Uint8Array(rect.w * rect.h);
  for (let y = 0; y < rect.h; y++) {
    const src = (rect.y + y) * width + rect.x;
    out.set(gray.subarray(src, src + rect.w), y * rect.w);
  }
  return { data: out, width: rect.w, height: rect.h };
}

/** Rotate clockwise by 0/90/180/270 degrees. */
export function rotateGray(bmp: Bitmap, degrees: 0 | 90 | 180 | 270): Bitmap {
  const { data, width: w, height: h } = bmp;
  if (degrees === 0) return bmp;
  const swap = degrees === 90 || degrees === 270;
  const ow = swap ? h : w;
  const oh = swap ? w : h;
  const out = new Uint8Array(ow * oh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      let ox: number;
      let oy: number;
      if (degrees === 90) {
        ox = h - 1 - y;
        oy = x;
      } else if (degrees === 180) {
        ox = w - 1 - x;
        oy = h - 1 - y;
      } else {
        ox = y;
        oy = w - 1 - x;
      }
      out[oy * ow + ox] = v;
    }
  }
  return { data: out, width: ow, height: oh };
}

/** Box-average downscale, used only for UI thumbnails. */
export function downscale(bmp: Bitmap, maxSide: number): Bitmap {
  const factor = Math.max(bmp.width, bmp.height) / maxSide;
  if (factor <= 1) return bmp;
  const ow = Math.max(1, Math.round(bmp.width / factor));
  const oh = Math.max(1, Math.round(bmp.height / factor));
  const out = new Uint8Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const sy0 = Math.floor((y * bmp.height) / oh);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * bmp.height) / oh));
    for (let x = 0; x < ow; x++) {
      const sx0 = Math.floor((x * bmp.width) / ow);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * bmp.width) / ow));
      let sum = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          sum += bmp.data[sy * bmp.width + sx];
          n++;
        }
      }
      out[y * ow + x] = n ? Math.round(sum / n) : 255;
    }
  }
  return { data: out, width: ow, height: oh };
}
