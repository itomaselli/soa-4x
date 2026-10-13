import { describe, expect, it } from "vitest";
import { createRng, seedToState, step } from "../src/sim/rng";

describe("RNG con semilla", () => {
  it("la misma semilla produce la misma secuencia", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 100 }, () => a.next());
    const seqB = Array.from({ length: 100 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("semillas distintas producen secuencias distintas", () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.next());
    const seqB = Array.from({ length: 10 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("la secuencia de la semilla 42 no cambia entre versiones", () => {
    // Golden values: if this test breaks, saved games and replays stop being reproducible.
    const rng = createRng(42);
    const values = Array.from({ length: 3 }, () => rng.next());
    expect(values).toMatchInlineSnapshot(`
      [
        0.6011037519201636,
        0.44829055899754167,
        0.8524657934904099,
      ]
    `);
  });

  it("guardar el estado y retomarlo continúa la misma secuencia", () => {
    const original = createRng(7);
    for (let i = 0; i < 25; i++) original.next();
    const saved = original.getState();
    const resumed = createRng(JSON.parse(JSON.stringify(saved)) as number);
    expect(Array.from({ length: 50 }, () => resumed.next())).toEqual(Array.from({ length: 50 }, () => original.next()));
  });

  it("step es puro: no muta nada y es repetible", () => {
    expect(step(123)).toEqual(step(123));
  });

  it("next() siempre está en [0, 1)", () => {
    for (let seed = 0; seed < 50; seed++) {
      const rng = createRng(seed);
      for (let i = 0; i < 200; i++) {
        const v = rng.next();
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("int(min, max) incluye ambos extremos y nunca se sale del rango", () => {
    const rng = createRng(99);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(1, 6);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("int rechaza rangos inválidos", () => {
    const rng = createRng(1);
    expect(() => rng.int(5, 1)).toThrow();
    expect(() => rng.int(0.5, 2)).toThrow();
  });

  it("la distribución es aproximadamente uniforme", () => {
    const rng = createRng(2024);
    const buckets = new Array<number>(10).fill(0);
    const samples = 100_000;
    for (let i = 0; i < samples; i++) {
      const idx = Math.floor(rng.next() * 10);
      buckets[idx] = (buckets[idx] ?? 0) + 1;
    }
    for (const count of buckets) {
      expect(Math.abs(count - samples / 10)).toBeLessThan(samples / 100);
    }
  });

  it("chance(0) nunca acierta y chance(1) siempre acierta", () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      expect(rng.chance(0)).toBe(false);
      expect(rng.chance(1)).toBe(true);
    }
  });

  it("pick elige elementos de la lista y falla con una lista vacía", () => {
    const rng = createRng(3);
    const items = ["a", "b", "c"] as const;
    for (let i = 0; i < 100; i++) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow();
  });

  it("la semilla se normaliza a un entero de 32 bits sin signo", () => {
    expect(seedToState(-1)).toBe(0xffffffff);
    expect(seedToState(3.9)).toBe(3);
    expect(() => seedToState(Number.NaN)).toThrow();
  });
});
