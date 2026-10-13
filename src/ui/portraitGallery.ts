// Debug gallery: 100 portraits to eyeball data/portraits.json. First the members of a new game, then made-up
// members cycling through every rank, status and patch. Served by `npm run dev` at /portraits.html.

import { loadGameData } from "../data/load";
import { createInitialState } from "../sim/setup";
import { MEMBER_STATUSES, RANKS } from "../sim/state";
import { h } from "./dom";
import { portraitCanvas } from "./portraitCanvas";
import { t } from "./strings";
import "./style.css";

const GALLERY_SIZE = 100;
const SCALE = 4;

const data = loadGameData();
const tr = (key: string) => t(data.strings, key);
const patches = data.patches.patches.map((p) => p.id);
const real = Object.values(createInitialState(data, { seed: 1, playerFactionId: "faction_iron_saints" }).members).map((m) => ({
  id: m.id,
  label: m.nickname || m.name,
  rank: m.rank,
  status: m.status,
  patchId: data.factions.find((f) => f.id === m.factionId)?.patchId ?? null,
}));
const made = Array.from({ length: Math.max(0, GALLERY_SIZE - real.length) }, (_, i) => ({
  id: `member_gallery_${String(i).padStart(3, "0")}`,
  label: `#${i}`,
  rank: RANKS[i % RANKS.length]!,
  status: MEMBER_STATUSES[Math.floor(i / RANKS.length) % MEMBER_STATUSES.length]!,
  patchId: patches[i % patches.length] ?? null,
}));

document.title = tr("gallery.title");
document.getElementById("gallery")?.replaceChildren(
  h("h1", { style: "margin: 16px 16px 0; font-size: 18px" }, [tr("gallery.title")]),
  h("p", { class: "hint", style: "margin: 4px 16px" }, [tr("gallery.hint")]),
  h(
    "div",
    { class: "gallery" },
    [...real, ...made].slice(0, GALLERY_SIZE).map((m) =>
      h("figure", { title: m.id }, [
        portraitCanvas(data, m, m.patchId, SCALE),
        h("strong", {}, [m.label]),
        h("span", { class: "muted" }, [`${tr(`rank.${m.rank}`)} · ${tr(`status.${m.status}`)}`]),
      ]),
    ),
  ),
);
