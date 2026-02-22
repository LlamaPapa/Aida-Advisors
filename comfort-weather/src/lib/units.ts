import { Units } from "./types";

export function fToC(f: number): number {
  return (f - 32) * 5 / 9;
}

export function cToF(c: number): number {
  return c * 9 / 5 + 32;
}

export function tempDisplay(tempF: number, units: Units): string {
  if (units === "C") return `${Math.round(fToC(tempF))}°C`;
  return `${Math.round(tempF)}°F`;
}

export function tempDisplayShort(tempF: number, units: Units): string {
  if (units === "C") return `${Math.round(fToC(tempF))}°`;
  return `${Math.round(tempF)}°`;
}
