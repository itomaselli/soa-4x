// Browser game controller. Holds the current GameState and the interface state (navigation and this week's
// drafts), builds the panels and calls resolveTurn. It never changes GameState directly (CLAUDE.md, rule 8).
// The map renderer is created once and only hidden while another view is open.

import type { GameData } from "../data/schemas";
import { createMapView, type HoverTarget, type MapView } from "../render/map";
import { reachableZones } from "../sim/orders";
import { createInitialState } from "../sim/setup";
import type { GameState, MapSize } from "../sim/state";
import { allAiOrders } from "../sim/systems/ai";
import { resolveTurn } from "../sim/turn";
import { gameData } from "../sim/scenario";
import { h } from "./dom";
import type { UiActions, UiContext } from "./context";
import { carryOverDraft, draftToOrders } from "./draft";
import { renderBusiness } from "./panels/business";
import { renderClub } from "./panels/club";
import { renderCouncil } from "./panels/council";
import { renderInspector, renderLegend, renderMapBar } from "./panels/county";
import { renderHeader, renderNav } from "./panels/header";
import { closeOverlayPatch, renderOverlay } from "./panels/modals";
import { renderReport } from "./panels/report";
import { clearAutosave, exportSave, importSave, loadAutosave, loadRenderMode, saveAutosave, saveRenderMode } from "./storage";
import { t } from "./strings";
import { afterResolution, canResolve, createUiState, enterDistrict, leaveDistrict, navigate, resetForGame, type UiState } from "./uiState";
import { localViewModel, lotDetails, mapViewModel, zoneTooltip } from "./viewModel";

const PLAYER_FACTION = "faction_iron_saints";
/** Preselected county size on the new game screen. */
const DEFAULT_MAP_SIZE: MapSize = "medium";

export interface AppElements {
  topBar: HTMLElement;
  nav: HTMLElement;
  countyView: HTMLElement;
  mapBar: HTMLElement;
  mapHost: HTMLElement;
  legend: HTMLElement;
  inspector: HTMLElement;
  panel: HTMLElement;
  tooltip: HTMLElement;
  overlay: HTMLElement;
}

/** Random seed for a new game. UI code may use the browser's randomness; the sim never does. */
function newSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 1;
}

export async function startApp(content: GameData, els: AppElements): Promise<void> {
  const tr = (key: string, params: Record<string, string | number> = {}) => t(content.strings, key, params);
  const saved = loadAutosave(content);
  let state: GameState = saved ?? createInitialState(content, { seed: newSeed(), playerFactionId: PLAYER_FACTION });
  // `data` is the content with this game's club names and patches applied (phase 11); refreshed in render().
  let data = gameData(content, state);
  const defaultPatch = content.factions.find((f) => f.id === PLAYER_FACTION)?.patchId ?? content.patches.patches[0]?.id ?? "";
  const hqOf = (s: GameState) => data.factions.find((f) => f.id === s.playerFactionId)?.hqZoneId ?? null;
  let ui: UiState = createUiState({
    selectedZoneId: hqOf(state),
    renderMode: loadRenderMode(),
    newGameForm: saved ? null : { name: content.factions.find((f) => f.id === PLAYER_FACTION)?.name ?? "", patchId: defaultPatch, size: DEFAULT_MAP_SIZE, firstTime: true },
  });

  const update = (next: UiState) => {
    ui = next;
    render();
  };
  const set = (patch: Partial<UiState>) => update({ ...ui, ...patch });

  const actions: UiActions = {
    navigate: (view) => update(navigate(ui, view)),
    selectZone: (zoneId) => update({ ...navigate(ui, "county"), selectedZoneId: zoneId }),
    enterZone: (zoneId) => {
      els.tooltip.hidden = true;
      update(enterDistrict(ui, zoneId));
    },
    leaveDistrict: () => update(leaveDistrict(ui)),
    pickOnMap: (memberId) => update({ ...navigate(ui, "county"), focusedMemberId: memberId }),
    openReview: () => {
      if (!state.outcome && !ui.resolving) set({ showReview: true });
    },
    resolveWeek,
    saveToFile: () => {
      exportSave(state, `biker4x-semana-${state.week}.json`);
      set({ notice: { text: tr("ui.saved_file"), error: false } });
    },
    loadFromFile: (file) => void loadFromFile(file),
    openNewGame: () => {
      const current = state.identities[state.playerFactionId];
      set({ newGameForm: { name: current?.name ?? "", patchId: current?.patchId ?? defaultPatch, size: state.scenario.size === "classic" ? DEFAULT_MAP_SIZE : state.scenario.size, firstTime: false } });
    },
    startNewGame: (name, patchId, size) => {
      void (async () => {
        clearAutosave();
        state = createInitialState(content, { seed: newSeed(), playerFactionId: PLAYER_FACTION, clubName: name, patchId, size });
        data = gameData(content, state);
        saveAutosave(state);
        await rebuildMapIfNeeded();
        update({ ...resetForGame(ui, hqOf(state)), newGameForm: null, notice: null });
      })();
    },
    toggleRenderMode: () => {
      const renderMode = ui.renderMode === "tiles" ? "ascii" : "tiles";
      saveRenderMode(renderMode);
      set({ renderMode });
    },
  };

  /**
   * Runs the engine once for the week, only from an open review. The review closes when the week is resolved,
   * so a second click (even on a button that was already replaced) or a repeated Enter does nothing.
   */
  function resolveWeek(): void {
    if (!canResolve(ui, state.outcome !== null)) return;
    ui = { ...ui, resolving: true };
    const mine = draftToOrders(ui.draft).assignments;
    const ai = allAiOrders(state, data, state.playerFactionId);
    const result = resolveTurn(
      state,
      {
        assignments: [...mine, ...ai.assignments],
        proposals: [...ui.proposals, ...(ai.proposals ?? [])],
        management: [...ui.management, ...(ai.management ?? [])],
        eventChoices: Object.entries(ui.eventChoices).map(([instanceId, optionId]) => ({ instanceId, optionId })),
      },
      data,
    );
    state = result.state;
    data = gameData(content, state);
    saveAutosave(state);
    update(afterResolution(ui, result.report, carryOverDraft(ui.draft, state, data)));
  }

  async function loadFromFile(file: File): Promise<void> {
    try {
      state = await importSave(file, content);
      data = gameData(content, state);
      saveAutosave(state);
      await rebuildMapIfNeeded();
      update({ ...resetForGame(ui, hqOf(state)), notice: { text: tr("ui.loaded_file", { week: state.week }), error: false } });
    } catch (error) {
      set({ notice: { text: `${tr("ui.load_failed")}\n${(error as Error).message}`, error: true } });
    }
  }

  const context = (): UiContext => ({ state, data, content, ui, tr, set, actions });

  const mapCallbacks = {
    onZoneClick: (zoneId: string) => {
      const entry = ui.focusedMemberId ? ui.draft[ui.focusedMemberId] : undefined;
      if (ui.focusedMemberId && entry && reachableZones(state, data, state.playerFactionId).includes(zoneId)) {
        set({ selectedZoneId: zoneId, draft: { ...ui.draft, [ui.focusedMemberId]: { ...entry, zoneId } } });
      } else {
        set({ selectedZoneId: zoneId });
      }
    },
    onZoneEnter: (zoneId: string) => actions.enterZone(zoneId),
    onExitClick: (zoneId: string) => actions.enterZone(zoneId),
    onLotClick: (lot: number) => set({ selectedLot: lot }),
    onHover: (target: HoverTarget | null, x: number, y: number) => showTooltip(target, x, y),
  };
  // The renderer is built for one map: it's created once per game (new game or loaded save), never per view.
  let map: MapView = await createMapView(els.mapHost, data, mapCallbacks);
  let mapScenario = state.scenario;
  async function rebuildMapIfNeeded(): Promise<void> {
    if (state.scenario === mapScenario) return;
    map.destroy();
    els.mapHost.replaceChildren();
    mapScenario = state.scenario;
    map = await createMapView(els.mapHost, data, mapCallbacks);
  }

  function showTooltip(target: HoverTarget | null, x: number, y: number): void {
    if (target?.kind === "lot" && ui.localZoneId) {
      const lot = lotDetails(state, data, state.playerFactionId, ui.localZoneId, target.index);
      els.tooltip.replaceChildren(
        h("strong", {}, [tr("ui.lot.title", { index: target.index + 1 })]),
        lot.business ? h("div", {}, [tr(lot.business.typeKey), " · ", h("span", { style: `color:${lot.business.color}` }, [lot.business.owner])]) : h("div", { class: "muted" }, [tr("ui.lot.empty")]),
      );
    } else if (target?.kind === "exit") {
      els.tooltip.replaceChildren(h("div", {}, [tr("ui.lot.exit", { zone: data.zones.find((z) => z.id === target.zoneId)?.name ?? "" })]));
    }
    if (target && target.kind !== "zone") {
      els.tooltip.style.left = `${x + 14}px`;
      els.tooltip.style.top = `${y + 14}px`;
      els.tooltip.hidden = false;
      return;
    }
    const tip = target?.kind === "zone" ? zoneTooltip(state, data, target.zoneId, state.playerFactionId) : null;
    if (!tip) {
      els.tooltip.hidden = true;
      return;
    }
    els.tooltip.replaceChildren(
      h("strong", {}, [tip.name]),
      h("div", { class: "muted" }, [tr(tip.typeKey)]),
      h("div", {}, [tr("ui.tip.owner"), " ", tip.owner ? h("span", { style: `color:${tip.owner.color}` }, [tip.owner.name]) : tr("ui.zone.no_owner")]),
      h("div", {}, [tr("ui.tip.control", { value: tip.ourControl })]),
      h("div", { class: tip.patrols ? "warn" : "" }, [tr("ui.tip.heat", { value: tip.heat })]),
      tip.businesses > 0 ? h("div", {}, [tr("ui.tip.businesses", { count: tip.businesses })]) : "",
    );
    els.tooltip.style.left = `${x + 14}px`;
    els.tooltip.style.top = `${y + 14}px`;
    els.tooltip.hidden = false;
  }

  // Clicking outside a window closes it (except the first new game screen and a week being resolved).
  els.overlay.addEventListener("click", (e) => {
    if (e.target !== els.overlay) return;
    const patch = closeOverlayPatch(context());
    if (patch) set(patch);
  });

  // Keyboard: Escape closes windows. Enter opens the weekly review from the main screen and, inside the review,
  // confirms only when the confirm button (or the review itself) has the focus. Never inside a form control.
  document.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    if (e.key === "Escape") {
      const patch = closeOverlayPatch(context());
      if (patch) {
        e.preventDefault();
        set(patch);
      }
      return;
    }
    if (e.key !== "Enter" || e.repeat || !target) return;
    if (ui.showReview) {
      if (target.id === "confirm-resolve" || target === document.body) {
        e.preventDefault();
        resolveWeek();
      }
      return;
    }
    const overlayOpen = !els.overlay.hidden;
    if (overlayOpen || ["INPUT", "SELECT", "TEXTAREA", "BUTTON", "A", "SUMMARY"].includes(target.tagName)) return;
    e.preventDefault();
    actions.openReview();
  });

  function render(): void {
    data = gameData(content, state);
    const ctx = context();
    els.topBar.replaceChildren(renderHeader(ctx), ui.notice ? h("div", { class: ui.notice.error ? "notice error" : "notice", role: "status" }, [ui.notice.text]) : "");
    els.nav.replaceChildren(renderNav(ctx));

    const overlay = renderOverlay(ctx);
    const wasOpen = !els.overlay.hidden;
    els.overlay.replaceChildren(...(overlay ? [overlay] : []));
    els.overlay.hidden = overlay === null;
    if (overlay && !wasOpen) (overlay.querySelector("#confirm-resolve, button.primary, input, button") as HTMLElement | null)?.focus();

    const county = ui.view === "county";
    els.countyView.hidden = !county;
    els.panel.hidden = county;
    if (county) {
      els.mapBar.replaceChildren(renderMapBar(ctx));
      els.legend.replaceChildren(renderLegend(ctx));
      els.inspector.replaceChildren(renderInspector(ctx));
    } else {
      els.tooltip.hidden = true;
      const body = ui.view === "club" ? renderClub(ctx) : ui.view === "council" ? renderCouncil(ctx) : ui.view === "business" ? renderBusiness(ctx) : renderReport(ctx);
      els.panel.replaceChildren(body);
    }

    // The map keeps its own state; it's updated even while hidden so it's ready when the county comes back.
    const planned = Object.values(ui.draft).map((e) => e.zoneId).filter((z): z is string => z !== null);
    const local = ui.localZoneId ? localViewModel(state, data, state.playerFactionId, ui.localZoneId, ui.selectedLot, planned) : null;
    const plannedTasks = Object.values(ui.draft).flatMap((e) => (e.zoneId ? [{ taskId: e.taskId, zoneId: e.zoneId }] : []));
    map.update(mapViewModel(state, data, state.playerFactionId, ui.selectedZoneId, planned, ui.renderMode, local, { plannedTasks, lastReport: ui.report }));
  }

  render();
}
