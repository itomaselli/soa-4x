// Browser entry point. Phase 0: load + validate data and show a status line.
// The PixiJS map and the panels arrive in phase 3.

import { DataValidationError, loadGameData } from "./data/load";
import { createInitialState } from "./sim/setup";
import { t } from "./ui/strings";

const PLAYER_FACTION = "faction_iron_saints";
const DEFAULT_SEED = 1;

const statusEl = document.getElementById("status");

try {
  const data = loadGameData();
  const state = createInitialState(data, { seed: DEFAULT_SEED, playerFactionId: PLAYER_FACTION });
  document.title = t(data.strings, "app.title");
  if (statusEl) {
    statusEl.textContent = [
      t(data.strings, "app.week", { week: state.week }),
      t(data.strings, "app.phase0_ok", {
        zones: data.zones.length,
        members: data.members.length,
        factions: data.factions.length,
      }),
    ].join("\n");
  }
} catch (error) {
  if (statusEl) {
    statusEl.classList.add("error");
    statusEl.textContent = error instanceof DataValidationError ? error.message : String(error);
  }
  throw error;
}
