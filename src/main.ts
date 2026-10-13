// Browser entry point: load and validate data, then start the game.

import { DataValidationError, loadGameData } from "./data/load";
import { startApp } from "./ui/app";
import { t } from "./ui/strings";
import "./ui/style.css";

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el;
};

try {
  const data = loadGameData();
  document.title = t(data.strings, "app.title");
  await startApp(data, {
    topBar: byId("topbar"),
    nav: byId("nav"),
    countyView: byId("county-view"),
    mapBar: byId("map-bar"),
    mapHost: byId("map-host"),
    legend: byId("legend"),
    inspector: byId("inspector"),
    panel: byId("panel"),
    tooltip: byId("tooltip"),
    overlay: byId("overlay"),
  });
} catch (error) {
  const status = byId("status");
  status.classList.add("error");
  status.textContent = error instanceof DataValidationError ? error.message : String(error);
  throw error;
}
