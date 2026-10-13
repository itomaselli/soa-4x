// Seeded, deterministic RNG (mulberry32).
// The whole generator state is a single uint32 so it can live inside GameState
// and survive JSON save/load. All randomness in src/sim must go through here.

export type RngState = number;

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  /** True with probability p (clamped to [0, 1]). */
  chance(p: number): boolean;
  /** Uniformly picks one element. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** Current state, to store back into GameState. */
  getState(): RngState;
}

const UINT32_RANGE = 4294967296;
const MULBERRY_INCREMENT = 0x6d2b79f5;

/** Normalizes any finite number into a valid uint32 seed. */
export function seedToState(seed: number): RngState {
  if (!Number.isFinite(seed)) {
    throw new Error(`Invalid RNG seed: ${seed}`);
  }
  return Math.trunc(seed) >>> 0;
}

/** Pure step: returns the next value and the next state without mutating anything. */
export function step(state: RngState): { value: number; state: RngState } {
  const nextState = (state + MULBERRY_INCREMENT) >>> 0;
  let t = nextState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE;
  return { value, state: nextState };
}

/** Creates a stateful wrapper starting from a stored state. */
export function createRng(initialState: RngState): Rng {
  let state = seedToState(initialState);

  const next = (): number => {
    const result = step(state);
    state = result.state;
    return result.value;
  };

  return {
    next,
    int(min, max) {
      if (!Number.isInteger(min) || !Number.isInteger(max) || max < min) {
        throw new Error(`Invalid int range: [${min}, ${max}]`);
      }
      return min + Math.floor(next() * (max - min + 1));
    },
    chance(p) {
      const clamped = Math.min(1, Math.max(0, p));
      return next() < clamped;
    },
    pick(items) {
      if (items.length === 0) {
        throw new Error("Cannot pick from an empty array");
      }
      return items[Math.floor(next() * items.length)] as (typeof items)[number];
    },
    getState: () => state,
  };
}
