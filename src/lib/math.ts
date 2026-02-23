export function parseNumber(value: string | undefined | null): number | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function roundToTwoDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

export function roundAndClamp(
  value: number,
  minValue: number,
  maxValue: number,
): number {
  return roundToTwoDecimals(clamp(value, minValue, maxValue));
}

export function toFixedScore(value: number): string {
  return roundToTwoDecimals(value).toFixed(2);
}
