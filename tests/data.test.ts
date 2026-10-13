import { describe, expect, it } from "vitest";
import { BUNDLED_RAW_DATA, DataValidationError, loadGameData, parseGameData, type RawGameData } from "../src/data/load";

/** Deep copy of the bundled data, so each test can break it without affecting others. */
function rawCopy(): RawGameData {
  return structuredClone(BUNDLED_RAW_DATA);
}

function problemsOf(raw: RawGameData): string[] {
  try {
    parseGameData(raw);
  } catch (error) {
    if (error instanceof DataValidationError) return error.problems;
    throw error;
  }
  return [];
}

// Helpers to mutate the raw JSON in a type-safe-enough way for tests.
type Obj = Record<string, unknown>;
const arr = (raw: RawGameData, key: keyof RawGameData) => raw[key] as Obj[];
const first = (raw: RawGameData, key: keyof RawGameData) => arr(raw, key)[0] as Obj;

describe("carga de datos", () => {
  it("los datos incluidos en /data son válidos", () => {
    expect(() => loadGameData()).not.toThrow();
  });

  it("los datos de ejemplo tienen 3 zonas y 4 miembros", () => {
    const data = loadGameData();
    expect(data.zones).toHaveLength(3);
    expect(data.members).toHaveLength(4);
  });

  it("las 10 tareas del GDD §7 están definidas", () => {
    expect(loadGameData().tasks).toHaveLength(10);
  });

  it("todo el contenido tiene su texto en español", () => {
    const problems = problemsOf(rawCopy());
    expect(problems.filter((p) => p.includes("strings.es.json"))).toEqual([]);
  });
});

describe("validación de datos: errores que se detectan", () => {
  it("rechaza un archivo con la forma equivocada y dice cuál es", () => {
    const raw = rawCopy();
    raw.zones = { not: "an array" };
    expect(problemsOf(raw).some((p) => p.startsWith("zones.json"))).toBe(true);
  });

  it("rechaza IDs que no son snake_case", () => {
    const raw = rawCopy();
    first(raw, "zones").id = "Zone Redwater";
    expect(problemsOf(raw).length).toBeGreaterThan(0);
  });

  it("rechaza IDs repetidos", () => {
    const raw = rawCopy();
    arr(raw, "members").push(structuredClone(first(raw, "members")));
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("id repetido"));
  });

  it("rechaza una zona adyacente que no existe", () => {
    const raw = rawCopy();
    (first(raw, "zones").adjacent as string[]).push("zone_atlantis");
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("zona adyacente desconocida"));
  });

  it("exige que la adyacencia sea simétrica", () => {
    const raw = rawCopy();
    const millbrook = arr(raw, "zones").find((z) => z.id === "zone_millbrook") as Obj;
    millbrook.adjacent = [];
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("no es simétrica"));
  });

  it("detecta zonas desconectadas del mapa", () => {
    const raw = rawCopy();
    for (const zone of arr(raw, "zones")) zone.adjacent = [];
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("desconectada"));
  });

  it("rechaza stats fuera del rango 1–10 de balance.json", () => {
    const raw = rawCopy();
    (first(raw, "members").stats as Obj).strength = 11;
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("strength 11 fuera de rango"));
  });

  it("rechaza control de zona por encima de 100", () => {
    const raw = rawCopy();
    first(raw, "zones").initialControl = { faction_iron_saints: 101 };
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("fuera de rango"));
  });

  it("rechaza un miembro de una facción que no existe", () => {
    const raw = rawCopy();
    first(raw, "members").factionId = "faction_ghosts";
    expect(problemsOf(raw)).toContainEqual(expect.stringContaining("facción desconocida"));
  });

  it("rechaza rasgos que no están en el GDD", () => {
    const raw = rawCopy();
    first(raw, "members").trait = "cobarde";
    expect(problemsOf(raw).length).toBeGreaterThan(0);
  });

  it("avisa si falta un texto en strings.es.json", () => {
    const raw = rawCopy();
    delete (raw.strings as Obj)["task.task_bribe"];
    expect(problemsOf(raw)).toContainEqual('strings.es.json: falta el texto "task.task_bribe"');
  });

  it("junta todos los problemas en un solo error en lugar de cortar en el primero", () => {
    const raw = rawCopy();
    (first(raw, "members").stats as Obj).hands = 0;
    first(raw, "members").loyalty = 150;
    expect(problemsOf(raw).length).toBeGreaterThanOrEqual(2);
  });
});
