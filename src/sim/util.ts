export interface Range {
  min: number;
  max: number;
}

export function clamp(value: number, range: Range): number {
  return Math.min(range.max, Math.max(range.min, value));
}
