// Draws a member portrait on a <canvas>, scaled with crisp pixels.

import type { GameData } from "../data/schemas";
import { portraitPixels, type PortraitSubject } from "../render/portrait";
import { pixelCanvas } from "./pixelCanvas";

export function portraitCanvas(data: GameData, subject: PortraitSubject, patchId: string | null, scale: number, title = ""): HTMLCanvasElement {
  return pixelCanvas(portraitPixels(data, subject, patchId), data.portraits.size, scale, "portrait", title);
}
