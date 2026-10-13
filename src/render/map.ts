// PixiJS map: draws the layout with ASCII glyphs from a bitmap font (GDD §15).
// It only reads a MapViewModel built by the UI; it never looks at game rules.

import { Application, Assets, BitmapFont, BitmapText, Container, Rectangle, Sprite, Texture, TextureStyle } from "pixi.js";
import tilesetUrl from "../../assets/tiles/kenney-1bit-monochrome.png?url";
import type { UiConfig } from "../data/schemas";
import { buildMapLayout, zoneAt, type MapLayout } from "./layout";
import type { GameData } from "../data/schemas";

export interface ZoneLook {
  borderColor: string;
  glyph: string;
  /** Sprite id for the tile view, e.g. "zone_type.town". */
  spriteId: string;
  glyphColor: string;
  labelColor: string;
  /** Show a heat marker next to the zone. */
  heatWarning: boolean;
  /** Up to 3 businesses, drawn on the top edge of the box in their owner's color. */
  businesses: { glyph: string; spriteId: string; color: string }[];
}

export type RenderMode = "tiles" | "ascii";

export interface MapViewModel {
  zones: Record<string, ZoneLook>;
  selectedZoneId: string | null;
  mode: RenderMode;
}

export interface MapView {
  update(model: MapViewModel): void;
  destroy(): void;
}

const FONT_NAME = "ascii-tiles";
const BOX = { corner: "+", horizontal: "-", vertical: "|" };
const HEAT_GLYPH = "!";

export interface MapCallbacks {
  onZoneClick: (zoneId: string) => void;
  /** Called with the zone under the pointer (or null) and the pointer position in page pixels. */
  onZoneHover?: (zoneId: string | null, pageX: number, pageY: number) => void;
}

export async function createMapView(host: HTMLElement, data: GameData, callbacks: MapCallbacks): Promise<MapView> {
  const ui: UiConfig = data.ui;
  const t = ui.tileSize;
  const layout: MapLayout = buildMapLayout(data);
  const baseWidth = layout.width * t;
  const baseHeight = layout.height * t;

  TextureStyle.defaultOptions.scaleMode = "nearest";
  const app = new Application();
  await app.init({
    width: baseWidth,
    height: baseHeight,
    background: ui.colors.background,
    antialias: false,
    roundPixels: true,
    resolution: 1,
  });
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

  const place = (text: BitmapText, x: number, y: number) => {
    text.x = x * t + Math.round((t - text.width) / 2);
    text.y = y * t + Math.round((t - text.height) / 2);
  };
  const glyph = (ch: string, x: number, y: number, color: string): BitmapText => {
    const text = new BitmapText({ text: ch, style: { fontFamily: FONT_NAME, fontSize: ui.font.size } });
    text.tint = color;
    place(text, x, y);
    return text;
  };
  /** Changes a sprite's character (re-centering it) only when it actually changes. */
  const setChar = (text: BitmapText, ch: string, x: number, y: number) => {
    if (text.text === ch) return;
    text.text = ch;
    place(text, x, y);
  };

  // Tileset: one texture per sprite id, cut from the sheet.
  const sheet = await Assets.load<Texture>(tilesetUrl);
  sheet.source.scaleMode = "nearest";
  const ts = ui.tileset.tileSize;
  const textures = new Map<string, Texture>();
  for (const [id, [col, row]] of Object.entries(ui.tileset.sprites)) {
    textures.set(id, new Texture({ source: sheet.source, frame: new Rectangle(col * ts, row * ts, ts, ts) }));
  }
  const tile = (x: number, y: number): Sprite => {
    const sprite = new Sprite(Texture.EMPTY);
    sprite.x = x * t + Math.round((t - ts) / 2);
    sprite.y = y * t + Math.round((t - ts) / 2);
    sprite.visible = false;
    return sprite;
  };
  /** Shows a sprite if the texture exists and we're in tile mode; returns whether it did. */
  const showTile = (sprite: Sprite, spriteId: string | undefined, color: string, mode: RenderMode): boolean => {
    const texture = spriteId ? textures.get(spriteId) : undefined;
    sprite.visible = mode === "tiles" && texture !== undefined;
    if (sprite.visible && texture) {
      sprite.texture = texture;
      sprite.tint = color;
    }
    return sprite.visible;
  };

  // Everything is created once; updates only change colors, text and visibility.
  const roadLayer = new Container();
  for (const road of layout.roads) roadLayer.addChild(glyph(road.glyph, road.x, road.y, ui.colors.road));
  const zoneLayer = new Container();
  app.stage.addChild(roadLayer, zoneLayer);

  interface ZoneSprites {
    border: BitmapText[];
    center: BitmapText;
    heat: BitmapText;
    label: BitmapText[];
    /** Tile-mode versions of the center, the top edge (businesses) and the heat marker. */
    centerTile: Sprite;
    topTiles: Sprite[];
    heatTile: Sprite;
  }
  const sprites = new Map<string, ZoneSprites>();
  for (const z of layout.zones) {
    const { x, y } = z.center;
    const border: BitmapText[] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const ch = dx !== 0 && dy !== 0 ? BOX.corner : dy !== 0 ? BOX.horizontal : BOX.vertical;
        border.push(glyph(ch, x + dx, y + dy, ui.colors.neutral));
      }
    }
    const center = glyph(" ", x, y, ui.colors.glyph);
    const heat = glyph(HEAT_GLYPH, x + 2, y - 1, ui.colors.heat);
    heat.visible = false;
    const label = [...z.label].map((ch, i) => glyph(ch, z.labelStart.x + i, z.labelStart.y, ui.colors.label));
    const centerTile = tile(x, y);
    const topTiles = [tile(x - 1, y - 1), tile(x, y - 1), tile(x + 1, y - 1)];
    const heatTile = tile(x + 2, y - 1);
    zoneLayer.addChild(...border, center, heat, ...label, centerTile, ...topTiles, heatTile);
    sprites.set(z.id, { border, center, heat, label, centerTile, topTiles, heatTile });
  }

  // Integer scaling only (crisp pixels): the largest scale that fits the host width, up to maxScale.
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

  app.stage.eventMode = "static";
  app.stage.hitArea = app.screen;
  app.stage.on("pointertap", (event) => {
    const tile = { x: Math.floor(event.global.x / (t * scale)), y: Math.floor(event.global.y / (t * scale)) };
    const zoneId = zoneAt(layout, tile);
    if (zoneId) callbacks.onZoneClick(zoneId);
  });
  app.stage.on("pointermove", (event) => {
    const tile = { x: Math.floor(event.global.x / (t * scale)), y: Math.floor(event.global.y / (t * scale)) };
    const zoneId = zoneAt(layout, tile);
    app.canvas.style.cursor = zoneId ? "pointer" : "default";
    const rect = app.canvas.getBoundingClientRect();
    callbacks.onZoneHover?.(zoneId, rect.left + window.scrollX + event.global.x, rect.top + window.scrollY + event.global.y);
  });
  app.stage.on("pointerleave", () => callbacks.onZoneHover?.(null, 0, 0));

  return {
    update(model) {
      for (const z of layout.zones) {
        const look = model.zones[z.id];
        const sp = sprites.get(z.id);
        if (!look || !sp) continue;
        const selected = model.selectedZoneId === z.id;
        for (const b of sp.border) b.tint = selected ? ui.colors.selected : look.borderColor;
        // Top edge (the first three border sprites): businesses, or the plain box edge.
        for (let i = 0; i < 3; i++) {
          const sprite = sp.border[i];
          const topTile = sp.topTiles[i];
          if (!sprite || !topTile) continue;
          const business = look.businesses[i];
          const plain = i === 1 ? BOX.horizontal : BOX.corner;
          const asTile = business ? showTile(topTile, business.spriteId, business.color, model.mode) : showTile(topTile, undefined, "", model.mode);
          setChar(sprite, asTile ? " " : (business?.glyph ?? plain), z.center.x - 1 + i, z.center.y - 1);
          if (business) sprite.tint = business.color;
        }
        const centerAsTile = showTile(sp.centerTile, look.spriteId, look.glyphColor, model.mode);
        setChar(sp.center, centerAsTile ? " " : look.glyph, z.center.x, z.center.y);
        sp.center.tint = look.glyphColor;
        const heatAsTile = look.heatWarning && showTile(sp.heatTile, "marker.heat", ui.colors.heat, model.mode);
        if (!look.heatWarning) sp.heatTile.visible = false;
        sp.heat.visible = look.heatWarning && !heatAsTile;
        for (const l of sp.label) l.tint = selected ? ui.colors.selected : look.labelColor;
      }
    },
    destroy() {
      observer.disconnect();
      app.destroy(true, { children: true });
    },
  };
}
