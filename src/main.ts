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
    mapBar: byId("map-bar"),
    topBar: byId("topbar"),
    mapHost: byId("map-host"),
    sidebar: byId("sidebar"),
    legend: byId("legend"),
    tooltip: byId("tooltip"),
    overlay: byId("overlay"),
  });
} catch (error) {
  const status = byId("status");
  status.classList.add("error");
  status.textContent = error instanceof DataValidationError ? error.message : String(error);
  throw error;
}
