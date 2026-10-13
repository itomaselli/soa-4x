import { describe, expect, it } from "vitest";
import { formatEntry, formatReport, formatStatus } from "../src/cli/text";
import type { ReportEntry } from "../src/sim/report";
import { baseData, newState, PLAYER, WOLVES } from "./helpers";

describe("modo texto", () => {
  it("traduce el informe al español, incluidos los parámetros que son claves", () => {
    const entry: ReportEntry = {
      stage: "orders",
      key: "report.order_rejected",
      params: { member: "Preacher", reasonKey: "order_error.zone_not_reachable" },
      factionId: PLAYER,
    };
    const text = formatEntry(entry, baseData);
    expect(text).toContain("Preacher");
    expect(text).toContain("fuera de alcance");
    expect(text).not.toMatch(/[⟨{]/);
  });

  it("el jugador no ve las entradas privadas de otras facciones", () => {
    const report: ReportEntry[] = [
      { stage: "faction_tasks", key: "report.task.lie_low", params: { member: "Nuestro", zone: "Redwater" }, factionId: PLAYER },
      { stage: "faction_tasks", key: "report.task.lie_low", params: { member: "Lobo", zone: "Millbrook" }, factionId: WOLVES },
    ];
    const text = formatReport(report, baseData, PLAYER).join("\n");
    expect(text).toContain("Nuestro");
    expect(text).not.toContain("Lobo");
  });

  it("el estado muestra la semana, la plata, las zonas y los miembros sin claves sin traducir", () => {
    const text = formatStatus(newState(), baseData, PLAYER).join("\n");
    expect(text).toContain("Semana 1");
    expect(text).toContain("Redwater");
    expect(text).toContain("Preacher");
    expect(text).not.toContain("⟨");
  });
});
