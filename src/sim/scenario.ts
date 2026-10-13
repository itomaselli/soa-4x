// A game's scenario: the map (zones, factions and their HQs, the cartel's port, the territory goal) is stored in
// GameState, so every game can have its own county. gameData() lays the scenario and the clubs' chosen names
// over the content, so the rest of the code keeps reading data.zones / data.factions as before.

import type { GameData } from "../data/schemas";
import { withIdentities } from "./identity";
import type { GameState, Scenario } from "./state";

/** The hand-made county from zones.json / factions.json (old saves and the default tests). */
export function classicScenario(content: GameData): Scenario {
  return {
    size: "classic",
    zones: structuredClone(content.zones),
    factions: structuredClone(content.factions),
    portZoneId: content.balance.cartel.portZoneId,
    zonesToControl: content.balance.victory.zonesToControl,
    memberCap: content.balance.club.memberCap,
  };
}

/** Content with this game's map and the clubs' names and patches. */
export function gameData(content: GameData, state: Pick<GameState, "scenario" | "identities">): GameData {
  const s = state.scenario;
  const data: GameData = {
    ...content,
    zones: s.zones,
    factions: s.factions,
    balance: {
      ...content.balance,
      cartel: { ...content.balance.cartel, portZoneId: s.portZoneId },
      victory: { ...content.balance.victory, zonesToControl: s.zonesToControl },
      club: { ...content.balance.club, memberCap: s.memberCap },
    },
  };
  return withIdentities(data, state as GameState);
}
