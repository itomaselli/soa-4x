// PixiJS map (phase 10): two views of the same canvas.
//   - County: the political map. Districts are filled with their owner's color and separated by borders
//     (dotted = connected zones, thick = no direct way through, outline = county edge). Each district shows its
//     icon, name, businesses and a heat marker. Click selects a district; double-click enters it.
//   - Zone: the district's local map (see localMap.ts) with its building lots, our members working there, exits
//     to neighbouring districts and landmarks (headquarters, gas station, motel). Click a lot to select it; click
//     an exit to walk over. Roads are autotiled: their sprites are rotated a quarter turn at a time.
// The renderer only reads a MapViewModel built by the UI; it never looks at game rules.

import { Application, Assets, BitmapFont, BitmapText, Container, Graphics, Rectangle, Sprite, Texture, TextureStyle } from "pixi.js";
import tilesetUrl from "../../assets/tiles/kenney-1bit-monochrome.png?url";
import type { GameData, UiConfig } from "../data/schemas";
import { buildMapLayout, zoneTiles, type MapLayout } from "./layout";
import { generateLocalMap, LOCAL_LOT_SIZE, type LocalMap } from "./localMap";
import { extraTilePixels } from "./extraTile";
import { patchPixels } from "./patch";
import { computeRegions, zoneAtTile, type RegionMap } from "./regions";

export type RenderMode = "tiles" | "ascii";

export interface ZoneLook {
  /** Owner's color, or null if nobody owns the district. */
  ownerColor: string | null;
  /** Owner's patch (phase 11), drawn instead of the district icon in tile mode. */
  ownerPatchId: string | null;
  glyph: string;
  /** Sprite id for the tile view, e.g. "zone_type.town". */
  spriteId: string;
  glyphColor: string;
  labelColor: string;
  /** Show a heat marker next to the zone. */
  heatWarning: boolean;
  /** Markers below the district icon (combat, raid warning, gun run, money, death), at most ui.markers.max. */
  markers: MarkerLook[];
  /** Mood face of the club headquartered here (only the viewer's own club). */
  mood: MarkerLook | null;
  /** Up to 3 businesses, drawn above the district icon in their owner's color. */
  businesses: { glyph: string; spriteId: string; color: string }[];
}

/** A marker sprite from the tileset with its ASCII glyph. */
export interface MarkerLook {
  spriteId: string;
  glyph: string;
  color: string;
}

export interface LotLook {
  index: number;
  business: { glyph: string; spriteId: string; color: string } | null;
  /** The business is a bar: it hangs its sign on the lot's free corner. */
  sign: boolean;
  /** We could build here (we own the district and the lot is free). */
  buildable: boolean;
  selected: boolean;
}

export interface LocalViewModel {
  zoneId: string;
  lots: LotLook[];
  /** Our members working in this district this week (planned tasks). */
  members: { color: string }[];
}

export interface MapViewModel {
  zones: Record<string, ZoneLook>;
  selectedZoneId: string | null;
  mode: RenderMode;
  /** null = county view. */
  local: LocalViewModel | null;
}

export interface MapView {
  update(model: MapViewModel): void;
  destroy(): void;
}

export type HoverTarget = { kind: "zone"; zoneId: string } | { kind: "lot"; index: number } | { kind: "exit"; zoneId: string };

export interface MapCallbacks {
  onZoneClick: (zoneId: string) => void;
  /** Double-click on a district in the county view. */
  onZoneEnter: (zoneId: string) => void;
  onLotClick: (index: number) => void;
  /** Exit arrow in the local view: go to the neighbouring district. */
  onExitClick: (zoneId: string) => void;
  /** Called with what's under the pointer (or null) and the pointer position in page pixels. */
  onHover?: (target: HoverTarget | null, pageX: number, pageY: number) => void;
}

const FONT_NAME = "ascii-tiles";
const OWNER_FILL_ALPHA = 0.22;
const SELECTED_FILL_ALPHA = 0.12;

/** Sparse background texture of each district type on the county map (deterministic per tile). */
const TERRAIN_DOTS: Record<string, { glyph: string; density: number }> = {
  town: { glyph: ".", density: 0.35 },
  road: { glyph: ".", density: 0.15 },
  port: { glyph: "~", density: 0.3 },
  rural: { glyph: '"', density: 0.4 },
  industrial: { glyph: ":", density: 0.3 },
};

function tileNoise(x: number, y: number): number {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245) >>> 0;
  return (h % 1000) / 1000;
}

export async function createMapView(host: HTMLElement, data: GameData, callbacks: MapCallbacks): Promise<MapView> {
  const ui: UiConfig = data.ui;
  const t = ui.tileSize;
  const layout: MapLayout = buildMapLayout(data);
  const regions: RegionMap = computeRegions(data);
  const baseWidth = layout.width * t;
  const baseHeight = layout.height * t;

  TextureStyle.defaultOptions.scaleMode = "nearest";
  const app = new Application();
  await app.init({ width: baseWidth, height: baseHeight, background: ui.colors.background, antialias: false, roundPixels: true, resolution: 1 });
  app.canvas.style.imageRendering = "pixelated";
  host.appendChild(app.canvas);

  BitmapFont.install({
    name: FONT_NAME,
    style: { fontFamily: ui.font.family, fontSize: ui.font.size, fill: "#ffffff" },
    chars: [[" ", "~"]],
    resolution: 1,
    padding: 2,
    textureStyle: { scaleMode: "nearest" },
  });

  // ---------- Tileset ----------
  const sheet = await Assets.load<Texture>(tilesetUrl);
  sheet.source.scaleMode = "nearest";
  const ts = ui.tileset.tileSize;
  const cut = ([col, row]: [number, number]) => new Texture({ source: sheet.source, frame: new Rectangle(col * ts, row * ts, ts, ts) });
  const textures = new Map<string, Texture>();
  for (const [id, coords] of Object.entries(ui.tileset.sprites)) textures.set(id, cut(coords));
  for (const [id, coords] of Object.entries(ui.localMap.sprites)) textures.set(`local.${id}`, cut(coords));
  const pixelTexture = (pixels: (string | null)[][], size: number): Texture => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx2d = canvas.getContext("2d");
    pixels.forEach((row, y) => row.forEach((c, x) => { if (c && ctx2d) { ctx2d.fillStyle = c; ctx2d.fillRect(x, y, 1, 1); } }));
    const texture = Texture.from(canvas);
    texture.source.scaleMode = "nearest";
    return texture;
  };
  // The project's own tiles: white on transparent, tinted like the Kenney sheet.
  for (const [id, extra] of Object.entries(data.tilesExtra.tiles)) textures.set(`extra.${id}`, pixelTexture(extraTilePixels(extra), data.tilesExtra.tileSize));
  /** Patch textures are made on demand from their pixels. */
  const patchTexture = (patchId: string): Texture | undefined => {
    const key = `patch.${patchId}`;
    if (!textures.has(key)) {
      const pixels = patchPixels(data, patchId);
      if (!pixels) return undefined;
      textures.set(key, pixelTexture(pixels, data.patches.size));
    }
    return textures.get(key);
  };

  // ---------- Helpers ----------
  const place = (obj: BitmapText | Sprite, x: number, y: number) => {
    obj.x = x * t + Math.round((t - obj.width) / 2);
    obj.y = y * t + Math.round((t - obj.height) / 2);
  };
  const glyph = (ch: string, x: number, y: number, color: string): BitmapText => {
    const text = new BitmapText({ text: ch, style: { fontFamily: FONT_NAME, fontSize: ui.font.size } });
    text.tint = color;
    place(text, x, y);
    return text;
  };
  const setChar = (text: BitmapText, ch: string, x: number, y: number) => {
    if (text.text === ch) return;
    text.text = ch;
    place(text, x, y);
  };
  /** Sprites are centered on their tile so they can turn and mirror in place. */
  const tile = (x: number, y: number): Sprite => {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.anchor.set(0.5);
    sprite.x = x * t + t / 2;
    sprite.y = y * t + t / 2;
    sprite.visible = false;
    return sprite;
  };
  /**
   * Shows a sprite if the texture exists and we're in tile mode; returns whether it did.
   * `turns` rotates it a quarter turn clockwise each (autotiled roads); `mirror` flips it in X.
   */
  const showTile = (sprite: Sprite, spriteId: string | undefined, color: string, mode: RenderMode, turns = 0, mirror = false): boolean => {
    const texture = spriteId ? textures.get(spriteId) : undefined;
    sprite.visible = mode === "tiles" && texture !== undefined;
    if (sprite.visible && texture) {
      sprite.texture = texture;
      sprite.tint = color;
      sprite.rotation = (turns * Math.PI) / 2;
      sprite.scale.x = mirror ? -1 : 1;
    }
    return sprite.visible;
  };

  // ---------- County view ----------
  const county = new Container();
  const fills = new Graphics();
  const terrainLayer = new Container();
  const borderLayer = new Graphics();
  const selectionLayer = new Graphics();
  const zoneLayer = new Container();
  county.addChild(fills, terrainLayer, borderLayer, selectionLayer, zoneLayer);

  const zoneType = new Map(data.zones.map((z) => [z.id, z.type]));
  // Keep the terrain texture away from icons and names so they stay readable.
  const reserved = new Set(layout.zones.flatMap((z) => zoneTiles(z).map((p) => `${p.x},${p.y}`)));
  for (const z of layout.zones) reserved.add(`${z.center.x + 2},${z.center.y - 1}`);
  for (let y = 0; y < regions.height; y++) {
    for (let x = 0; x < regions.width; x++) {
      const id = zoneAtTile(regions, x, y);
      const dots = id ? TERRAIN_DOTS[zoneType.get(id) ?? ""] : undefined;
      if (dots && !reserved.has(`${x},${y}`) && tileNoise(x, y) < dots.density) terrainLayer.addChild(glyph(dots.glyph, x, y, ui.colors.road));
    }
  }

  // Borders never change: draw them once.
  const segment = (g: Graphics, b: { x: number; y: number; side: "right" | "bottom" }) => {
    const x0 = (b.x + 1) * t;
    const y0 = (b.y + 1) * t;
    if (b.side === "right") g.moveTo(x0, b.y * t).lineTo(x0, y0);
    else g.moveTo(b.x * t, y0).lineTo(x0, y0);
  };
  for (const b of regions.borders.filter((b) => b.kind === "closed")) segment(borderLayer, b);
  borderLayer.stroke({ width: 2, color: ui.colors.border.closed });
  for (const b of regions.borders.filter((b) => b.kind === "edge")) segment(borderLayer, b);
  borderLayer.stroke({ width: 2, color: ui.colors.border.edge });
  // Open borders: dotted (every other half tile).
  for (const b of regions.borders.filter((b) => b.kind === "open")) {
    const x0 = (b.x + 1) * t;
    const y0 = (b.y + 1) * t;
    if (b.side === "right") borderLayer.moveTo(x0, b.y * t + t * 0.25).lineTo(x0, b.y * t + t * 0.75);
    else borderLayer.moveTo(b.x * t + t * 0.25, y0).lineTo(b.x * t + t * 0.75, y0);
  }
  borderLayer.stroke({ width: 1, color: ui.colors.border.open });

  interface ZoneSprites {
    center: BitmapText;
    centerTile: Sprite;
    heat: BitmapText;
    heatTile: Sprite;
    label: BitmapText[];
    marks: BitmapText[];
    markTiles: Sprite[];
    /** Event markers on the row below the icon, and the mood face to its right. */
    markers: { glyph: BitmapText; tile: Sprite }[];
    mood: { glyph: BitmapText; tile: Sprite };
  }
  const heatGlyph = ui.tileset.glyphs["marker.heat"] ?? "!";
  const sprites = new Map<string, ZoneSprites>();
  for (const z of layout.zones) {
    const { x, y } = z.center;
    const center = glyph(" ", x, y, ui.colors.glyph);
    const centerTile = tile(x, y);
    const heat = glyph(heatGlyph, x + 2, y - 1, ui.colors.heat);
    const heatTile = tile(x + 2, y - 1);
    const label = [...z.label].map((ch, i) => glyph(ch, z.labelStart.x + i, z.labelStart.y, ui.colors.label));
    const marks = [0, 1, 2].map((i) => glyph(" ", x - 1 + i, y - 1, ui.colors.label));
    const markTiles = [0, 1, 2].map((i) => tile(x - 1 + i, y - 1));
    const markers = Array.from({ length: ui.markers.max }, (_, i) => ({ glyph: glyph(" ", x - 1 + i, y + 1, ui.colors.label), tile: tile(x - 1 + i, y + 1) }));
    const mood = { glyph: glyph(" ", x + 1, y, ui.colors.label), tile: tile(x + 1, y) };
    zoneLayer.addChild(center, centerTile, heat, heatTile, ...label, ...marks, ...markTiles, ...markers.flatMap((m) => [m.glyph, m.tile]), mood.glyph, mood.tile);
    sprites.set(z.id, { center, centerTile, heat, heatTile, label, marks, markTiles, markers, mood });
  }

  // ---------- Local view (one cached layer per district) ----------
  interface LocalLayer {
    container: Container;
    map: LocalMap;
    terrainGlyphs: { glyph: BitmapText; sprite: Sprite; spriteId: string | null; turns: number; color: string; char: string; x: number; y: number }[];
    landmarks: { glyph: BitmapText; sprite: Sprite; spriteId: string; color: string; char: string; x: number; y: number }[];
    lotFrames: Graphics;
    lotGlyphs: BitmapText[];
    lotTiles: Sprite[];
    signGlyphs: BitmapText[];
    signTiles: Sprite[];
    memberGlyphs: BitmapText[];
    memberTiles: Sprite[];
  }
  const landmarksUi = ui.localMap.landmarks;
  const barSignGlyph = data.tilesExtra.tiles[landmarksUi.barSign.replace(/^extra\./, "")]?.glyph ?? "Y";
  const localLayers = new Map<string, LocalLayer>();
  const localRoot = new Container();
  app.stage.addChild(county, localRoot);

  const buildLocal = (zoneId: string): LocalLayer => {
    const map = generateLocalMap(data, zoneId);
    const container = new Container();
    const colors = ui.localMap.colors;
    const terrainGlyphs: LocalLayer["terrainGlyphs"] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const cell = map.tiles[y]![x]!;
        const color = colors[cell.terrain] ?? ui.colors.label;
        const g = glyph(cell.glyph, x, y, color);
        const s = tile(x, y);
        container.addChild(g, s);
        terrainGlyphs.push({ glyph: g, sprite: s, spriteId: cell.sprite ? `local.${cell.sprite}` : null, turns: cell.rotation, color, char: cell.glyph, x, y });
      }
    }
    const landmarks = map.landmarks.map((l) => {
      const color = (l.factionId ? data.factions.find((f) => f.id === l.factionId)?.color : undefined) ?? colors.landmark ?? ui.colors.glyph;
      const g = glyph(l.glyph, l.x, l.y, color);
      const s = tile(l.x, l.y);
      container.addChild(g, s);
      return { glyph: g, sprite: s, spriteId: l.sprite, color, char: l.glyph, x: l.x, y: l.y };
    });
    const lotFrames = new Graphics();
    container.addChild(lotFrames);
    const lotGlyphs = map.lots.map((lot) => glyph(" ", lot.x + 1, lot.y + 1, colors.lot ?? ui.colors.selected));
    const lotTiles = map.lots.map((lot) => tile(lot.x + 1, lot.y + 1));
    container.addChild(...lotGlyphs, ...lotTiles);
    const signGlyphs = map.lots.map((lot) => glyph(" ", lot.signSpot.x, lot.signSpot.y, colors.landmark ?? ui.colors.glyph));
    const signTiles = map.lots.map((lot) => tile(lot.signSpot.x, lot.signSpot.y));
    container.addChild(...signGlyphs, ...signTiles);
    for (const exit of map.exits) {
      container.addChild(glyph(exit.arrow, exit.x, exit.y, colors.exit ?? ui.colors.selected));
      const name = data.zones.find((z) => z.id === exit.zoneId)?.shortName ?? "";
      const lx = Math.min(map.width - name.length, Math.max(0, exit.x - Math.floor(name.length / 2)));
      const ly = exit.y === 0 ? 1 : exit.y === map.height - 1 ? map.height - 2 : exit.y + 1;
      const inward = exit.x === 0 ? 1 : exit.x === map.width - 1 ? map.width - name.length - 1 : lx;
      [...name].forEach((ch, i) => container.addChild(glyph(ch, inward + i, ly, colors.exit ?? ui.colors.selected)));
    }
    const memberGlyphs = map.memberSpots.map((p) => glyph("@", p.x, p.y, colors.member ?? ui.colors.glyph));
    const memberTiles = map.memberSpots.map((p) => tile(p.x, p.y));
    container.addChild(...memberGlyphs, ...memberTiles);
    return { container, map, terrainGlyphs, landmarks, lotFrames, lotGlyphs, lotTiles, signGlyphs, signTiles, memberGlyphs, memberTiles };
  };
  const localFor = (zoneId: string): LocalLayer => {
    let layer = localLayers.get(zoneId);
    if (!layer) {
      layer = buildLocal(zoneId);
      localLayers.set(zoneId, layer);
    }
    return layer;
  };

  // ---------- Scaling ----------
  let scale = 1;
  const fit = () => {
    const available = Math.max(host.clientWidth, baseWidth);
    scale = Math.max(1, Math.min(ui.maxScale, Math.floor(available / baseWidth)));
    app.renderer.resize(baseWidth * scale, baseHeight * scale);
    app.stage.scale.set(scale);
  };
  const observer = new ResizeObserver(fit);
  observer.observe(host);
  fit();

  // ---------- Input ----------
  let current: MapViewModel | null = null;
  const tileAt = (gx: number, gy: number) => ({ x: Math.floor(gx / (t * scale)), y: Math.floor(gy / (t * scale)) });
  const hitTest = (gx: number, gy: number): HoverTarget | null => {
    const { x, y } = tileAt(gx, gy);
    if (current?.local) {
      const map = localFor(current.local.zoneId).map;
      const lot = map.lots.find((l) => x >= l.x && x < l.x + LOCAL_LOT_SIZE && y >= l.y && y < l.y + LOCAL_LOT_SIZE);
      if (lot) return { kind: "lot", index: lot.index };
      const exit = map.exits.find((e) => Math.abs(e.x - x) <= 1 && Math.abs(e.y - y) <= 1);
      return exit ? { kind: "exit", zoneId: exit.zoneId } : null;
    }
    const zoneId = zoneAtTile(regions, x, y);
    return zoneId ? { kind: "zone", zoneId } : null;
  };

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointertap", (event) => {
    const target = hitTest(event.global.x, event.global.y);
    if (!target) return;
    if (target.kind === "lot") callbacks.onLotClick(target.index);
    else if (target.kind === "exit") callbacks.onExitClick(target.zoneId);
    else callbacks.onZoneClick(target.zoneId);
  });
  // Double-click enters a district (native event: reliable with mice, trackpads and touch).
  app.canvas.addEventListener("dblclick", (event) => {
    if (current?.local) return;
    const rect = app.canvas.getBoundingClientRect();
    const target = hitTest(event.clientX - rect.left, event.clientY - rect.top);
    if (target?.kind === "zone") callbacks.onZoneEnter(target.zoneId);
  });
  app.stage.on("pointermove", (event) => {
    const target = hitTest(event.global.x, event.global.y);
    app.canvas.style.cursor = target ? "pointer" : "default";
    const rect = app.canvas.getBoundingClientRect();
    callbacks.onHover?.(target, rect.left + window.scrollX + event.global.x, rect.top + window.scrollY + event.global.y);
  });
  app.stage.on("pointerleave", () => callbacks.onHover?.(null, 0, 0));

  // ---------- Updates ----------
  const updateCounty = (model: MapViewModel) => {
    fills.clear();
    selectionLayer.clear();
    for (let y = 0; y < regions.height; y++) {
      for (let x = 0; x < regions.width; x++) {
        const id = zoneAtTile(regions, x, y);
        const color = id ? model.zones[id]?.ownerColor : null;
        if (color) fills.rect(x * t, y * t, t, t).fill({ color, alpha: OWNER_FILL_ALPHA });
        if (id && id === model.selectedZoneId) fills.rect(x * t, y * t, t, t).fill({ color: ui.colors.selected, alpha: SELECTED_FILL_ALPHA });
      }
    }
    if (model.selectedZoneId) {
      for (const b of regions.borders) {
        if (b.a === model.selectedZoneId || b.b === model.selectedZoneId) segment(selectionLayer, b);
      }
      selectionLayer.stroke({ width: 2, color: ui.colors.selected });
    }
    for (const z of layout.zones) {
      const look = model.zones[z.id];
      const sp = sprites.get(z.id);
      if (!look || !sp) continue;
      const selected = model.selectedZoneId === z.id;
      const patch = look.ownerPatchId && model.mode === "tiles" ? patchTexture(look.ownerPatchId) : undefined;
      if (patch) {
        sp.centerTile.texture = patch;
        sp.centerTile.tint = 0xffffff;
        sp.centerTile.visible = true;
      }
      const centerAsTile = patch ? true : showTile(sp.centerTile, look.spriteId, look.glyphColor, model.mode);
      setChar(sp.center, centerAsTile ? " " : look.glyph, z.center.x, z.center.y);
      sp.center.tint = look.glyphColor;
      for (let i = 0; i < 3; i++) {
        const business = look.businesses[i];
        const asTile = business ? showTile(sp.markTiles[i]!, business.spriteId, business.color, model.mode) : showTile(sp.markTiles[i]!, undefined, "", model.mode);
        setChar(sp.marks[i]!, asTile || !business ? " " : business.glyph, z.center.x - 1 + i, z.center.y - 1);
        if (business) sp.marks[i]!.tint = business.color;
      }
      sp.markers.forEach((slot, i) => {
        const marker = look.markers[i];
        const asTile = marker ? showTile(slot.tile, marker.spriteId, marker.color, model.mode) : showTile(slot.tile, undefined, "", model.mode);
        setChar(slot.glyph, asTile || !marker ? " " : marker.glyph, z.center.x - 1 + i, z.center.y + 1);
        if (marker) slot.glyph.tint = marker.color;
      });
      const moodAsTile = look.mood ? showTile(sp.mood.tile, look.mood.spriteId, look.mood.color, model.mode) : showTile(sp.mood.tile, undefined, "", model.mode);
      setChar(sp.mood.glyph, moodAsTile || !look.mood ? " " : look.mood.glyph, z.center.x + 1, z.center.y);
      if (look.mood) sp.mood.glyph.tint = look.mood.color;
      const heatAsTile = look.heatWarning && showTile(sp.heatTile, "marker.heat", ui.colors.heat, model.mode);
      if (!look.heatWarning) sp.heatTile.visible = false;
      sp.heat.visible = look.heatWarning && !heatAsTile;
      for (const l of sp.label) l.tint = selected ? ui.colors.selected : look.labelColor;
    }
  };

  const updateLocal = (model: LocalViewModel, mode: RenderMode) => {
    const layer = localFor(model.zoneId);
    localRoot.removeChildren();
    localRoot.addChild(layer.container);
    for (const cell of layer.terrainGlyphs) {
      const asTile = showTile(cell.sprite, cell.spriteId ?? undefined, cell.color, mode, cell.turns);
      setChar(cell.glyph, asTile ? " " : cell.char, cell.x, cell.y);
    }
    for (const l of layer.landmarks) {
      const asTile = showTile(l.sprite, l.spriteId, l.color, mode);
      setChar(l.glyph, asTile ? " " : l.char, l.x, l.y);
    }
    const frames = layer.lotFrames;
    frames.clear();
    const colors = ui.localMap.colors;
    layer.map.lots.forEach((lot, i) => {
      const look = model.lots[i];
      const g = layer.lotGlyphs[i]!;
      const s = layer.lotTiles[i]!;
      const color = look?.business?.color ?? (look?.selected ? ui.colors.selected : (colors.lot ?? ui.colors.selected));
      frames.rect(lot.x * t + 1, lot.y * t + 1, LOCAL_LOT_SIZE * t - 2, LOCAL_LOT_SIZE * t - 2);
      frames.stroke({ width: look?.selected ? 2 : 1, color, alpha: look?.business || look?.buildable || look?.selected ? 1 : 0.4 });
      const signTile = layer.signTiles[i]!;
      const signAsTile = look?.sign ? showTile(signTile, landmarksUi.barSign, look.business?.color ?? color, mode) : showTile(signTile, undefined, "", mode);
      setChar(layer.signGlyphs[i]!, look?.sign && !signAsTile ? barSignGlyph : " ", lot.signSpot.x, lot.signSpot.y);
      if (look?.business) layer.signGlyphs[i]!.tint = look.business.color;
      if (look?.business) {
        const asTile = showTile(s, look.business.spriteId, look.business.color, mode);
        setChar(g, asTile ? " " : look.business.glyph, lot.x + 1, lot.y + 1);
        g.tint = look.business.color;
      } else {
        s.visible = false;
        setChar(g, look?.buildable ? "+" : " ", lot.x + 1, lot.y + 1);
        g.tint = color;
      }
    });
    layer.memberGlyphs.forEach((g, i) => {
      const member = model.members[i];
      const s = layer.memberTiles[i]!;
      // Riders face the middle of the map: the sprite looks right, so those on the right half are mirrored.
      const spot = layer.map.memberSpots[i]!;
      const mirror = spot.x >= layer.map.width / 2;
      const asTile = member ? showTile(s, landmarksUi.member, member.color, mode, 0, mirror) : showTile(s, undefined, "", mode);
      g.visible = !!member && !asTile;
      if (member) g.tint = member.color;
    });
  };

  return {
    update(model) {
      current = model;
      county.visible = model.local === null;
      localRoot.visible = model.local !== null;
      if (model.local) updateLocal(model.local, model.mode);
      else updateCounty(model);
    },
    destroy() {
      observer.disconnect();
      app.destroy(true, { children: true });
    },
  };
}
