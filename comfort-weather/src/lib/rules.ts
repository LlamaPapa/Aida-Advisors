import { Recommendation, ConditionInputs, PrefsInputs } from "./types";

/**
 * Deterministic clothing recommendation engine.
 * All temps in °F internally.
 */
export function getRecommendation(
  conditions: ConditionInputs,
  prefs: PrefsInputs
): Recommendation {
  const effectiveTemp = computeEffectiveTemp(conditions, prefs);
  return buildStack(effectiveTemp, conditions, prefs);
}

// ── Effective temperature ──

function computeEffectiveTemp(c: ConditionInputs, p: PrefsInputs): number {
  const windPenalty = computeWindPenalty(c.windSpeed, c.windGust, p.timeOutside);
  const wetPenalty = computeWetPenalty(c.pop, c.rainIntensity, c.snowIntensity);
  const sunBonus = computeSunBonus(c);
  const runsAdj = p.runsTemp === "cold" ? 4 : p.runsTemp === "hot" ? -4 : 0;
  const activityAdj = p.activity === "workout" ? 8 : p.activity === "walking" ? 3 : 0;

  return (
    c.temp -
    windPenalty +
    sunBonus -
    wetPenalty +
    p.comfortOffsetF +
    runsAdj +
    activityAdj
  );
}

function computeWindPenalty(speed: number, gust: number, timeOutside: number): number {
  const effectiveWind = Math.max(speed, gust * 0.7);
  const timeFactor = timeOutside >= 60 ? 1.3 : timeOutside >= 30 ? 1.0 : 0.7;
  if (effectiveWind < 5) return 0;
  if (effectiveWind < 10) return 2 * timeFactor;
  if (effectiveWind < 20) return 5 * timeFactor;
  return 8 * timeFactor;
}

function computeWetPenalty(pop: number, rain: number, snow: number): number {
  const hasPrecip = rain > 0 || snow > 0;
  if (pop >= 0.6) return hasPrecip ? 5 : 3;
  if (pop >= 0.35 && hasPrecip) return 3;
  return 0;
}

function computeSunBonus(c: ConditionInputs): number {
  if (!c.isDaytime) return 0;
  if (c.windSpeed > 10) return 0;
  if (c.pop > 0.3) return 0;
  return 3;
}

// ── Layer mapping ──

interface Stack {
  base: string;
  mid: string;
  outer: string;
  extras: string[];
}

function buildStack(
  eff: number,
  c: ConditionInputs,
  p: PrefsInputs
): Recommendation {
  const stack = selectLayers(eff, c, p);

  // Hate sweaty: shift lighter and prefer breathable
  if (p.hateSweaty) {
    stack.base = lighterBase(stack.base);
    if (stack.outer.includes("insulated")) {
      stack.outer = "wind shell";
    }
  }

  const why = buildWhy(eff, c, p);

  return {
    base: stack.base,
    mid: stack.mid,
    outer: stack.outer,
    extras: stack.extras.length > 0 ? stack.extras.join(", ") : "none",
    why,
  };
}

function selectLayers(eff: number, c: ConditionInputs, p: PrefsInputs): Stack {
  const windy = c.windSpeed > 12 || (c.windGust > 20);
  const rainy = c.pop >= 0.35 && (c.rainIntensity > 0 || c.pop >= 0.6);
  const snowy = c.snowIntensity > 0 && c.pop >= 0.35;
  const longTime = p.timeOutside >= 30;

  if (eff >= 70) {
    return {
      base: "t-shirt",
      mid: "none",
      outer: rainy ? "light rain shell" : "none",
      extras: rainy ? ["umbrella"] : [],
    };
  }
  if (eff >= 60) {
    return {
      base: eff >= 65 ? "t-shirt" : "long-sleeve tee",
      mid: eff < 65 ? "light layer" : "none",
      outer: rainy ? "light rain shell" : windy ? "light wind shell" : "none",
      extras: rainy ? ["umbrella"] : [],
    };
  }
  if (eff >= 50) {
    return {
      base: "long-sleeve shirt",
      mid: "light fleece",
      outer: windy || rainy ? "light shell" : "none",
      extras: rainy ? ["umbrella"] : [],
    };
  }
  if (eff >= 40) {
    const extras: string[] = [];
    if (windy || eff < 45) extras.push("beanie");
    if (rainy || snowy) extras.push("umbrella");
    return {
      base: "long-sleeve shirt",
      mid: "fleece",
      outer: rainy ? "waterproof shell" : windy ? "insulated shell" : "light insulated jacket",
      extras,
    };
  }
  if (eff >= 30) {
    const extras = ["beanie"];
    if (windy || longTime) extras.push("gloves");
    if (rainy || snowy) extras.push("waterproof outer");
    return {
      base: "thermal base layer",
      mid: "fleece",
      outer: "insulated jacket",
      extras,
    };
  }
  if (eff >= 20) {
    return {
      base: "thermal base layer",
      mid: "heavy fleece",
      outer: "warm insulated coat",
      extras: ["beanie", "insulated gloves"],
    };
  }
  // Below 20°F
  const extras = ["beanie", "insulated gloves", "scarf / neck gaiter"];
  if (windy) extras.push("face coverage");
  return {
    base: "heavy thermal base layer",
    mid: "heavy fleece",
    outer: "heavy insulated coat",
    extras,
  };
}

function lighterBase(base: string): string {
  if (base.includes("heavy thermal")) return "thermal base layer";
  if (base.includes("thermal")) return "long-sleeve shirt";
  return base;
}

function buildWhy(eff: number, c: ConditionInputs, p: PrefsInputs): string {
  const parts: string[] = [];
  parts.push(`Effective temp: ${Math.round(eff)}°F`);
  if (c.windSpeed > 10) parts.push(`wind ${Math.round(c.windSpeed)} mph`);
  if (c.pop >= 0.35) parts.push(`${Math.round(c.pop * 100)}% precip chance`);
  if (p.hateSweaty) parts.push("breathable picks");
  if (p.activity === "workout") parts.push("active wear");
  const why = parts.join(". ") + ".";
  return why.length > 120 ? why.slice(0, 117) + "..." : why;
}
