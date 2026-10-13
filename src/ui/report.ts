// Turns ReportEntry[] into Spanish text. Shared by the terminal and the browser.

import type { GameData } from "../data/schemas";
import { TURN_STAGES, type ReportEntry, type TurnStage } from "../sim/report";
import { t } from "./strings";

/** Params whose name ends in "Key" are strings.es.json keys and get translated too; "Keys" = several, joined by "|". */
export function formatEntry(entry: ReportEntry, data: GameData): string {
  const params: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(entry.params)) {
    if (typeof value === "string" && name.endsWith("Keys")) params[name] = value.split("|").filter(Boolean).map((k) => t(data.strings, k)).join(", ");
    else params[name] = name.endsWith("Key") && typeof value === "string" ? t(data.strings, value) : value;
  }
  return t(data.strings, entry.key, params);
}

export interface ReportSection {
  stage: TurnStage;
  title: string;
  lines: string[];
}

/** Report grouped by stage, showing only public entries and the viewer's own. */
export function reportSections(report: readonly ReportEntry[], data: GameData, viewerFactionId: string): ReportSection[] {
  const visible = report.filter((e) => e.factionId === null || e.factionId === viewerFactionId);
  return TURN_STAGES.map((stage) => ({
    stage,
    title: t(data.strings, `report.stage.${stage}`),
    lines: visible.filter((e) => e.stage === stage).map((e) => formatEntry(e, data)),
  })).filter((s) => s.lines.length > 0);
}

export function formatReport(report: readonly ReportEntry[], data: GameData, viewerFactionId: string): string[] {
  return reportSections(report, data, viewerFactionId).flatMap((s) => [`[${s.title}]`, ...s.lines.map((l) => `  ${l}`)]);
}
