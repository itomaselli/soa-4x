import { loadGameData } from "../src/data/load";
import type { GameData } from "../src/data/schemas";
import { createInitialState } from "../src/sim/setup";
import type { GameState, MemberState, ZoneState } from "../src/sim/state";

export const PLAYER = "faction_iron_saints";
export const WOLVES = "faction_grim_wolves";
export const SHERIFF = "faction_sheriff";

export const baseData: GameData = loadGameData();

/** Copy of the game data with a modification, e.g. to switch off arrests in a test. */
export function dataWith(mutate: (d: GameData) => void): GameData {
  const copy = structuredClone(baseData);
  mutate(copy);
  return copy;
}

/** Data where illegal tasks never end in arrest. */
export const noArrestData = dataWith((d) => {
  d.balance.arrest.minChance = 0;
  d.balance.arrest.maxChance = 0;
});

/** Data where illegal tasks always end in arrest. */
export const alwaysArrestData = dataWith((d) => {
  d.balance.arrest.minChance = 1;
  d.balance.arrest.maxChance = 1;
});

export function newState(seed = 42, data: GameData = baseData): GameState {
  return createInitialState(data, { seed, playerFactionId: PLAYER });
}

export function zone(state: GameState, id: string): ZoneState {
  const z = state.zones[id];
  if (!z) throw new Error(`no zone ${id}`);
  return z;
}

export function member(state: GameState, id: string): MemberState {
  const m = state.members[id];
  if (!m) throw new Error(`no member ${id}`);
  return m;
}

export function money(state: GameState, factionId = PLAYER) {
  const f = state.factions[factionId];
  if (!f) throw new Error(`no faction ${factionId}`);
  return f.money;
}

/** Puts every player member except the listed ones in jail for a long time, so they don't act or interfere. */
export function benchAllExcept(state: GameState, keep: string[]): void {
  for (const m of Object.values(state.members)) {
    if (m.factionId === PLAYER && !keep.includes(m.id)) {
      m.status = "jailed";
      m.statusWeeks = 99;
    }
  }
}

// Members from data/members.json
export const PRESIDENT = "member_jack_harlan"; // charm 7, strength 6, cunning 6
export const VP = "member_dale_brody"; // strength 7
export const PROSPECT = "member_cody_reese"; // strength 3, charm 2
export const SERGEANT = "member_ray_dawson"; // strength 8
