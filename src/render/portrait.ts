// Member portraits: layered size×size pieces from data/portraits.json, each layer painted with one ink.
// Which piece and which ink is drawn from a seed derived from the member id, so a member always looks the
// same. The rank picks the vest (and the club patch on the chest); the status adds a bandage, bars or
// turns the portrait gray. Pure function, shared by the interface (canvas) and the debug gallery.

import type { GameData, PortraitLayer } from "../data/schemas";
import { createRng, type Rng } from "../sim/rng";
import type { MemberStatus, Rank } from "../sim/state";
import { hashId } from "./hash";
import { patchPixels } from "./patch";

export type PixelGrid = (string | null)[][];

/** What a portrait depends on. Only the id decides the face; rank and status are drawn on top. */
export interface PortraitSubject {
  id: string;
  rank: Rank;
  status: MemberStatus;
}

/** The pieces and inks a member got; exposed for tests and the gallery. */
export interface PortraitPicks {
  inks: Record<string, string>;
  /** Layer id → piece id, or null when the layer drew "none". */
  pieces: Record<string, string | null>;
}

function pickFrom<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng.next() * items.length)]!;
}

/** Same id, same picks. Ink and piece draws happen in data order, so adding pieces at the end keeps most faces. */
export function portraitPicks(data: GameData, memberId: string): PortraitPicks {
  const p = data.portraits;
  const rng = createRng(hashId(memberId));
  const inks: Record<string, string> = {};
  for (const [key, colors] of Object.entries(p.inks)) inks[key] = pickFrom(rng, colors);
  const pieces: Record<string, string | null> = {};
  for (const layer of [...p.under, ...p.over]) {
    const ids = Object.keys(layer.pieces);
    const ticket = Math.floor(rng.next() * (ids.length + layer.noneWeight));
    pieces[layer.id] = ids[ticket] ?? null;
  }
  return { inks, pieces };
}

function paint(grid: PixelGrid, rows: readonly string[], color: string, dx = 0, dy = 0): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === "#" && grid[y + dy]?.[x + dx] !== undefined) grid[y + dy]![x + dx] = color;
    }
  });
}

function paintLayer(grid: PixelGrid, layer: PortraitLayer, picks: PortraitPicks): void {
  const piece = picks.pieces[layer.id];
  const color = picks.inks[layer.ink];
  if (piece && color) paint(grid, layer.pieces[piece] ?? [], color);
}

/** The club patch scaled down (nearest pixel) into the vest's patch slot. */
function paintPatch(grid: PixelGrid, data: GameData, patchId: string): void {
  const patch = patchPixels(data, patchId);
  if (!patch) return;
  const { x: ox, y: oy, size } = data.portraits.patchSlot;
  const scale = patch.length / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const color = patch[Math.floor((y + 0.5) * scale)]?.[Math.floor((x + 0.5) * scale)];
      if (color && grid[oy + y]?.[ox + x] !== undefined) grid[oy + y]![ox + x] = color;
    }
  }
}

function gray(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  // Rec. 601 luma, the classic "black and white photo" weights.
  const luma = Math.round(0.299 * (n >> 16) + 0.587 * ((n >> 8) & 0xff) + 0.114 * (n & 0xff));
  const c = luma.toString(16).padStart(2, "0");
  return `#${c}${c}${c}`;
}

export function portraitPixels(data: GameData, subject: PortraitSubject, patchId: string | null): PixelGrid {
  const p = data.portraits;
  const picks = portraitPicks(data, subject.id);
  const grid: PixelGrid = Array.from({ length: p.size }, () => Array<string | null>(p.size).fill(p.background));

  for (const layer of p.under) paintLayer(grid, layer, picks);
  const rank = p.ranks[subject.rank];
  const vestColor = picks.inks[p.vestInk];
  if (vestColor) paint(grid, p.vests[rank.vest] ?? [], vestColor);
  if (rank.tab !== null && rank.tabInk !== null) paint(grid, p.tabs[rank.tab] ?? [], rank.tabInk);
  if (rank.patch && patchId) paintPatch(grid, data, patchId);
  for (const layer of p.over) paintLayer(grid, layer, picks);

  const overlay = p.status.overlays[subject.status];
  if (overlay) paint(grid, overlay.pixels, overlay.ink);
  if (p.status.grayscale.includes(subject.status)) {
    return grid.map((row) => row.map((c) => (c === null ? null : gray(c))));
  }
  return grid;
}
