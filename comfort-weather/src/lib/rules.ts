import { Conditions, Prefs, Recommendation } from "./types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function windPenaltyF(windMph: number, timeOutsideMin: number) {
  const penalty = (windMph / 3) * (timeOutsideMin / 30);
  return clamp(penalty, 0, 10);
}

function wetPenaltyF(pop: number) {
  if (pop >= 0.6) return 6;
  if (pop >= 0.35) return 3;
  return 0;
}

function activityAdjustF(activity: Prefs["activity"]) {
  if (activity === "walking") return 2;
  if (activity === "workout") return 8;
  return 0;
}

function runHotColdAdjustF(run: Prefs["run"]) {
  if (run === "cold") return 4;
  if (run === "hot") return -4;
  return 0;
}

function whyLine(c: Conditions, p: Prefs) {
  const parts: string[] = [];
  if (c.windMph >= 12) parts.push(`Wind ${Math.round(c.windMph)} mph`);
  if (c.pop >= 0.6) parts.push(`High precip chance`);
  else if (c.pop >= 0.35) parts.push(`Possible precip`);
  if (p.timeOutsideMinutes >= 30) parts.push(`${p.timeOutsideMinutes} min outside`);
  if (parts.length === 0) return `Based on your comfort settings`;
  return parts.join(" \u2022 ").slice(0, 120);
}

function layerMap(effectiveTempF: number, c: Conditions) {
  const windy = c.windMph >= 12;
  const rainy = c.pop >= 0.35;

  if (effectiveTempF >= 70) {
    return { base: "T-shirt", mid: "None", outer: "None", extras: [] as string[] };
  }
  if (effectiveTempF >= 60) {
    const outer = windy || rainy ? "Light shell" : "None";
    return { base: "T-shirt or long-sleeve", mid: "Optional light layer", outer, extras: [] as string[] };
  }
  if (effectiveTempF >= 50) {
    const outer = windy || rainy ? "Light shell" : "None";
    return { base: "Long-sleeve", mid: "Light fleece", outer, extras: [] as string[] };
  }
  if (effectiveTempF >= 40) {
    return { base: "Long-sleeve", mid: "Fleece", outer: "Light insulated or shell+mid", extras: [] as string[] };
  }
  if (effectiveTempF >= 30) {
    return { base: "Thermal / long-sleeve", mid: "Fleece", outer: "Insulated jacket", extras: ["Beanie"] };
  }
  if (effectiveTempF >= 20) {
    return { base: "Thermal", mid: "Fleece", outer: "Warm insulated coat", extras: ["Beanie", "Gloves"] };
  }
  return { base: "Thermal", mid: "Heavy fleece", outer: "Warm insulated coat", extras: ["Beanie", "Gloves", "Neck gaiter"] };
}

export function getRecommendation(c: Conditions, p: Prefs): Recommendation {
  const eff =
    c.tempF
    + p.comfortOffsetF
    + runHotColdAdjustF(p.run)
    - windPenaltyF(c.windMph, p.timeOutsideMinutes)
    - wetPenaltyF(c.pop)
    + activityAdjustF(p.activity);

  let mapped = layerMap(eff, c);

  // Sweat preference: nudge lighter near boundaries
  if (p.hateSweaty) {
    if (eff >= 38 && eff < 45) {
      mapped = { ...mapped, outer: "Shell + mid (avoid heavy insulation)" };
    }
    if (p.activity === "workout") {
      mapped = { ...mapped, mid: "Optional light layer", extras: mapped.extras.filter(x => x !== "Gloves") };
    }
  }

  // Add extras based on wind/time outside
  const extras = new Set(mapped.extras);
  if (c.windMph >= 15 && p.timeOutsideMinutes >= 30) extras.add("Gloves");
  if (c.windMph >= 10 && p.timeOutsideMinutes >= 60) extras.add("Gloves");
  if (c.windMph >= 15) extras.add("Beanie");
  if (c.pop >= 0.35) extras.add("Rain shell / umbrella");

  return {
    effectiveTempF: Math.round(eff),
    base: mapped.base,
    mid: mapped.mid,
    outer: mapped.outer,
    extras: Array.from(extras),
    why: whyLine(c, p),
  };
}
