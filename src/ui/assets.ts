// UI illustrations (assets/ui/illustrations, cut from the generated atlas by scripts/extract-ui-illustrations.py).
// Only for interface panels: map tiles never use them. URLs come from Vite, so they work in dev, in the build and
// in the Tauri app. A missing or broken picture falls back to the game's glyph, without breaking the panel.

import manifest from "../../assets/ui/source/assets-manifest.json";
import { h } from "./dom";

const urls = import.meta.glob("../../assets/ui/illustrations/*.png", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

/** Side of every exported illustration (common transparent canvas). Display sizes divide it exactly. */
export const ILLUSTRATION_SIZE = 252;
export const ILLUSTRATION_SIZES = { small: ILLUSTRATION_SIZE / 4, medium: ILLUSTRATION_SIZE / 3, large: ILLUSTRATION_SIZE / 2 } as const;
export type IllustrationSize = keyof typeof ILLUSTRATION_SIZES;

const byId = new Map(manifest.assets.map((a) => [a.id, a.filename]));

export function illustrationUrl(id: string | null): string | null {
  const file = id ? byId.get(id) : undefined;
  return file ? (urls[`../../assets/ui/illustrations/${file}`] ?? null) : null;
}

/** An <img> of the illustration, or the glyph if there's none (or it fails to load). The label goes in alt. */
export function illustration(id: string | null, size: IllustrationSize, label: string, glyph: string): HTMLElement {
  const px = ILLUSTRATION_SIZES[size];
  const fallback = () => h("span", { class: `illustration glyph ${size}`, role: "img", "aria-label": label }, [glyph]);
  const url = illustrationUrl(id);
  if (!url) return fallback();
  const img = h("img", { class: `illustration ${size}`, src: url, alt: label, width: String(px), height: String(px), draggable: "false" });
  img.addEventListener("error", () => img.replaceWith(fallback()), { once: true });
  return img;
}
