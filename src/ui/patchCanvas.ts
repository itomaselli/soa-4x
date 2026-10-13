// Draws a club patch on a <canvas> (phase 11), scaled with crisp pixels.

import type { GameData } from "../data/schemas";
import { patchPixels } from "../render/patch";

export function patchCanvas(data: GameData, patchId: string | null, scale: number, title = ""): HTMLCanvasElement {
  const size = data.patches.size;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.width = `${size * scale}px`;
  canvas.style.height = `${size * scale}px`;
  canvas.style.imageRendering = "pixelated";
  canvas.className = "patch";
  if (title) canvas.title = title;
  const pixels = patchId ? patchPixels(data, patchId) : null;
  const ctx = canvas.getContext("2d");
  if (!ctx || !pixels) return canvas;
  pixels.forEach((row, y) =>
    row.forEach((color, x) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  return canvas;
}
