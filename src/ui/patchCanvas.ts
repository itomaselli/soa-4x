// Draws a club patch on a <canvas> (phase 11), scaled with crisp pixels.

import type { GameData } from "../data/schemas";
import { patchPixels } from "../render/patch";
import { pixelCanvas } from "./pixelCanvas";

export function patchCanvas(data: GameData, patchId: string | null, scale: number, title = ""): HTMLCanvasElement {
  return pixelCanvas(patchId ? patchPixels(data, patchId) : null, data.patches.size, scale, "patch", title);
}
