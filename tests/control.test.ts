import { describe, expect, it } from "vitest";
import { freeControl, gainControl, loseControl, ownedZones, strongestRival, zoneOwner } from "../src/sim/systems/control";
import type { ZoneState } from "../src/sim/state";
import { baseData, newState, PLAYER, WOLVES } from "./helpers";

const balance = baseData.balance;
const z = (control: Record<string, number>): ZoneState => ({ id: "zone_test", control, heat: 0, policePresence: 0 });

describe("dueño de una zona (GDD §5)", () => {
  it("es dueño quien supera 50 y le saca 20 al segundo", () => {
    expect(zoneOwner(z({ [PLAYER]: 51, [WOLVES]: 31 }), balance)).toBe(PLAYER);
  });

  it("con exactamente 50 no alcanza", () => {
    expect(zoneOwner(z({ [PLAYER]: 50 }), balance)).toBeNull();
  });

  it("si la ventaja sobre el segundo es menor a 20 no hay dueño", () => {
    expect(zoneOwner(z({ [PLAYER]: 55, [WOLVES]: 36 }), balance)).toBeNull();
  });

  it("una zona sin control no tiene dueño", () => {
    expect(zoneOwner(z({}), balance)).toBeNull();
  });

  it("al empezar, cada club es dueño solo de su sede", () => {
    const state = newState();
    expect(ownedZones(state, PLAYER, balance)).toEqual(["zone_redwater"]);
    expect(ownedZones(state, WOLVES, balance)).toEqual(["zone_millbrook"]);
  });
});

describe("control de zona: la suma de todas las facciones nunca pasa de 100", () => {
  it("ganar control solo ocupa el espacio libre", () => {
    const zone = z({ [PLAYER]: 70, [WOLVES]: 25 });
    expect(freeControl(zone, balance)).toBe(5);
    expect(gainControl(zone, PLAYER, 10, balance)).toBe(5);
    expect(zone.control[PLAYER]).toBe(75);
  });

  it("perder control nunca baja de 0", () => {
    const zone = z({ [WOLVES]: 3 });
    expect(loseControl(zone, WOLVES, 10, balance)).toBe(3);
    expect(zone.control[WOLVES]).toBe(0);
  });

  it("el rival más fuerte es el que más control tiene (sin contarse a uno mismo)", () => {
    expect(strongestRival(z({ [PLAYER]: 90, [WOLVES]: 5, faction_cartel_valdes: 5 }), PLAYER)).toBe("faction_cartel_valdes");
    expect(strongestRival(z({ [PLAYER]: 90 }), PLAYER)).toBeNull();
  });
});

describe("erosión de influencia (rompe empates)", () => {
  // Imported lazily here to keep the pure helper tests above independent of the turn.
  const run = async (setup: (s: ReturnType<typeof newState>) => void, assignments: { memberId: string; taskId: string; zoneId: string }[] = []) => {
    const { resolveTurn } = await import("../src/sim/turn");
    const state = newState();
    setup(state);
    return resolveTurn(state, { assignments }, baseData);
  };
  const erosion = baseData.balance.control.erosionPerWeek;

  it("se pierde control en zonas que no son nuestras y donde nadie del club actuó esa semana", async () => {
    const { state } = await run(() => {});
    expect(state.zones["zone_dry_creek"]?.control[PLAYER]).toBe(30 - erosion);
  });

  it("si un miembro actuó en la zona, no hay erosión ahí", async () => {
    const { state } = await run(() => {}, [{ memberId: "member_dale_brody", taskId: "task_lie_low", zoneId: "zone_dry_creek" }]);
    expect(state.zones["zone_dry_creek"]?.control[PLAYER]).toBe(30);
  });

  it("las zonas propias y la sede no se erosionan", async () => {
    const { state } = await run((s) => {
      s.zones["zone_cedar_flats"]!.control = { [PLAYER]: 60 };
    });
    expect(state.zones["zone_cedar_flats"]?.control[PLAYER]).toBe(60);
    expect(state.zones["zone_redwater"]?.control[PLAYER]).toBe(70);
  });

  it("el informe avisa cuánto control se perdió", async () => {
    const { report } = await run(() => {});
    expect(report.some((e) => e.key === "report.control.erosion" && e.factionId === PLAYER)).toBe(true);
  });
});
