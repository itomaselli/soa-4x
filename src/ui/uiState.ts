// Interface state: navigation, selections and the player's drafts for this week (orders, proposals, management,
// event answers). It is NOT game state: it is never saved with the game and changing it never touches GameState.
// Navigation helpers are pure so tests can check that moving around never loses a draft.

import type { Proposal } from "../sim/council";
import type { ManagementOrder } from "../sim/management";
import type { MapSize, ProposalType } from "../sim/state";
import type { ReportEntry } from "../sim/report";
import type { RenderMode } from "../render/map";
import type { Draft } from "./draft";
import type { ChainId } from "./productionChains";

export const VIEWS = ["county", "club", "council", "business", "report"] as const;
export type View = (typeof VIEWS)[number];

export interface ProposalForm {
  type: ProposalType;
  targetMemberId: string;
  targetFactionId: string;
  newRank: string;
  businessTypeId: string;
  zoneId: string;
  force: boolean;
}

export interface NewGameForm {
  name: string;
  patchId: string;
  /** County size for the new game (phase 12). */
  size: MapSize;
  firstTime: boolean;
}

export interface UiState {
  view: View;
  /** District highlighted on the county map and shown in the inspector. */
  selectedZoneId: string | null;
  /** District shown zoomed in (Condado > Distrito), or null for the county. Kept while visiting other views. */
  localZoneId: string | null;
  selectedLot: number | null;
  /** Member whose destination is being picked on the map. */
  focusedMemberId: string | null;
  /** Member whose sheet is open. */
  sheetMemberId: string | null;
  showHqSheet: boolean;
  showHelp: boolean;
  showReview: boolean;
  newGameForm: NewGameForm | null;
  outcomeDismissed: boolean;
  /** The week is being resolved: blocks a second click. */
  resolving: boolean;
  renderMode: RenderMode;
  notice: { text: string; error: boolean } | null;

  // Drafts for this week.
  draft: Draft;
  proposals: Proposal[];
  form: ProposalForm;
  management: ManagementOrder[];
  eventChoices: Record<string, string>;
  /** Specialty chosen per member this week (phase 13): member id → perk id. */
  perkChoices: Record<string, string>;

  // Business view.
  chain: ChainId;
  chainNode: string | null;
  launderAmount: number;
  buyQuantities: Record<string, number>;
  sellAmounts: Record<string, number>;

  /** Last week's report. */
  report: ReportEntry[];
}

export const EMPTY_FORM: ProposalForm = { type: "promote", targetMemberId: "", targetFactionId: "", newRank: "", businessTypeId: "", zoneId: "", force: false };

export function createUiState(options: { selectedZoneId: string | null; renderMode: RenderMode; newGameForm: NewGameForm | null }): UiState {
  return {
    view: "county",
    selectedZoneId: options.selectedZoneId,
    localZoneId: null,
    selectedLot: null,
    focusedMemberId: null,
    sheetMemberId: null,
    showHqSheet: false,
    showHelp: false,
    showReview: false,
    newGameForm: options.newGameForm,
    outcomeDismissed: false,
    resolving: false,
    renderMode: options.renderMode,
    notice: null,
    draft: {},
    proposals: [],
    form: { ...EMPTY_FORM },
    management: [],
    eventChoices: {},
    perkChoices: {},
    chain: "motorcycles",
    chainNode: null,
    launderAmount: 0,
    buyQuantities: {},
    sellAmounts: {},
    report: [],
  };
}

/** Switches the main view. Drafts, the selected district/lot and the zoomed-in district are kept. */
export function navigate(ui: UiState, view: View): UiState {
  return { ...ui, view };
}

/** Condado > Distrito: zoom into a district. */
export function enterDistrict(ui: UiState, zoneId: string): UiState {
  return { ...ui, view: "county", localZoneId: zoneId, selectedZoneId: zoneId, selectedLot: null };
}

/** Back to the county map (keeps the district selected). */
export function leaveDistrict(ui: UiState): UiState {
  return { ...ui, localZoneId: null, selectedLot: null };
}

/** After resolving a week: this week's queued orders are spent; the member draft is carried over by the caller. */
export function afterResolution(ui: UiState, report: ReportEntry[], draft: Draft): UiState {
  return { ...ui, report, draft, proposals: [], management: [], eventChoices: {}, perkChoices: {}, focusedMemberId: null, showReview: false, resolving: false, notice: null, view: "report" };
}

/** A new or loaded game starts with empty drafts. */
export function resetForGame(ui: UiState, selectedZoneId: string | null): UiState {
  return {
    ...ui,
    view: "county",
    selectedZoneId,
    localZoneId: null,
    selectedLot: null,
    focusedMemberId: null,
    sheetMemberId: null,
    showHqSheet: false,
    showReview: false,
    outcomeDismissed: false,
    resolving: false,
    draft: {},
    proposals: [],
    form: { ...EMPTY_FORM },
    management: [],
    eventChoices: {},
    perkChoices: {},
    chainNode: null,
    launderAmount: 0,
    report: [],
  };
}

/** The week can be resolved only from an open review, once, and never after the game ended. */
export function canResolve(ui: UiState, gameOver: boolean): boolean {
  return ui.showReview && !ui.resolving && !gameOver;
}
