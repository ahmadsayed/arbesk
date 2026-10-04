/**
 * Unit-aware formatting for asset facts.
 * @remarks `metadata.computed.dimensions` are stored in glTF units
 *   ("meters") or, for CAD-stamped 3MF roots, "mm". The per-asset
 *   `metadata.annotations.units` field picks the display unit.
 */

export type Units = "m" | "cm" | "mm";

export function readUnits(
  annotations: Record<string, unknown> | null | undefined
): Units {
  const u = annotations?.units;
  return u === "mm" || u === "cm" || u === "m" ? u : "m";
}

interface Dims {
  width?: number;
  height?: number;
  depth?: number;
  unit?: string;
}

/** Normalize a stored value to meters (the glTF reference unit). */
function toMeters(v: number, unit?: string): number {
  return unit === "mm" ? v / 1000 : v;
}

const SCALE: Record<Units, number> = { m: 1, cm: 100, mm: 1000 };
const DECIMALS: Record<Units, number> = { m: 2, cm: 1, mm: 0 };

function formatValue(meters: number, units: Units): string {
  const x = meters * SCALE[units];
  const dec = DECIMALS[units];
  if (dec === 0) return String(Math.round(x));
  // fixed decimals, then strip trailing zeros (and a bare trailing dot)
  return x.toFixed(dec).replace(/\.?0+$/, "");
}

export function formatDimensions(d: Dims, units: Units): string {
  const raw = [d?.width, d?.height, d?.depth];
  if (raw.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
    return "—";
  }
  const vals = (raw as number[]).map((n) =>
    formatValue(toMeters(n, d?.unit), units)
  );
  return `${vals.join(" × ")} ${units}`;
}

/** 990 → "990", 12400 → "12.4k". */
export function formatCountCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(Math.round(n));
  return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}
