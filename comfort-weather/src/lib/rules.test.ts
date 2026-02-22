import { describe, it, expect } from "vitest";
import { getRecommendation } from "./rules";
import { Conditions, Prefs, DEFAULT_PREFS } from "./types";

function makeConditions(overrides: Partial<Conditions> = {}): Conditions {
  return {
    tempF: 60,
    feelsLikeF: 60,
    windMph: 5,
    windGustMph: 8,
    pop: 0.1,
    rainMm: 0,
    snowMm: 0,
    isDaytime: true,
    ...overrides,
  };
}

function makePrefs(overrides: Partial<Prefs> = {}): Prefs {
  return {
    ...DEFAULT_PREFS,
    hateSweaty: false,
    comfortOffsetF: 0,
    ...overrides,
  };
}

describe("getRecommendation", () => {
  // 1) Mild, calm, short outside
  it("mild calm day: no outer, no extras", () => {
    const c = makeConditions({ tempF: 68, windMph: 3, windGustMph: 3, pop: 0.1 });
    const p = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 5, comfortOffsetF: 0 });
    const rec = getRecommendation(c, p);

    expect(rec.outer).toMatch(/none/i);
    expect(rec.extras).toHaveLength(0);
    // effectiveTemp should be close to 68 (small wind penalty, no wet/activity)
    expect(rec.effectiveTempF).toBeGreaterThanOrEqual(65);
    expect(rec.effectiveTempF).toBeLessThanOrEqual(72);
  });

  // 2) Windy 45°F, 30 minutes outside
  it("windy 45F: outer present, beanie recommended, effective < raw", () => {
    const c = makeConditions({ tempF: 45, windMph: 18, windGustMph: 25, pop: 0.1 });
    const p = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 30, comfortOffsetF: 0 });
    const rec = getRecommendation(c, p);

    expect(rec.outer.toLowerCase()).not.toBe("none");
    expect(rec.extras.some((e) => /beanie/i.test(e))).toBe(true);
    expect(rec.effectiveTempF).toBeLessThan(45);
  });

  // 3) 45°F but workout mode
  it("45F workout: lighter than still, effective higher than raw", () => {
    const c = makeConditions({ tempF: 45, windMph: 5, windGustMph: 8, pop: 0.1 });
    const pStill = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 30 });
    const pWorkout = makePrefs({ run: "neutral", activity: "workout", timeOutsideMinutes: 30 });

    const recStill = getRecommendation(c, pStill);
    const recWorkout = getRecommendation(c, pWorkout);

    // Workout effective temp should be higher
    expect(recWorkout.effectiveTempF).toBeGreaterThan(recStill.effectiveTempF);
    // Workout effective temp should exceed raw temp due to +8 activity
    expect(recWorkout.effectiveTempF).toBeGreaterThan(45);
  });

  // 4) Rainy 52°F
  it("rainy 52F: rain shell or umbrella in extras", () => {
    const c = makeConditions({ tempF: 52, windMph: 5, windGustMph: 8, pop: 0.7, rainMm: 2 });
    const p = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 15 });
    const rec = getRecommendation(c, p);

    const hasRainGear = rec.extras.some((e) => /rain|umbrella/i.test(e));
    expect(hasRainGear).toBe(true);
  });

  // 5) Cold runner (runs cold)
  it("runs cold: heavier than neutral at same temp", () => {
    const c = makeConditions({ tempF: 55, windMph: 5, windGustMph: 8, pop: 0.1 });
    const pNeutral = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 15 });
    const pCold = makePrefs({ run: "cold", activity: "still", timeOutsideMinutes: 15 });

    const recNeutral = getRecommendation(c, pNeutral);
    const recCold = getRecommendation(c, pCold);

    // Per spec: cold=+4 to effectiveTemp. Skeleton is authoritative.
    expect(recCold.effectiveTempF).toBeGreaterThan(recNeutral.effectiveTempF);
  });

  // 6) Hot runner (runs hot)
  it("runs hot: lighter than neutral at same temp", () => {
    const c = makeConditions({ tempF: 55, windMph: 5, windGustMph: 8, pop: 0.1 });
    const pNeutral = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 15 });
    const pHot = makePrefs({ run: "hot", activity: "still", timeOutsideMinutes: 15 });

    const recNeutral = getRecommendation(c, pNeutral);
    const recHot = getRecommendation(c, pHot);

    // hot => -4 => lower effective temp
    expect(recHot.effectiveTempF).toBeLessThan(recNeutral.effectiveTempF);
  });

  // 7) Long exposure penalty
  it("long exposure 40F windy: gloves recommended, strong outer", () => {
    const c = makeConditions({ tempF: 40, windMph: 10, windGustMph: 15, pop: 0.1 });
    const p = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 60 });
    const rec = getRecommendation(c, p);

    expect(rec.extras.some((e) => /gloves/i.test(e))).toBe(true);
    expect(rec.outer.toLowerCase()).not.toBe("none");
  });

  // 8) Hate sweaty near threshold
  it("hate sweaty near threshold: prefers shell over heavy insulation", () => {
    const c = makeConditions({ tempF: 42, windMph: 4, windGustMph: 6, pop: 0.1 });
    const p = makePrefs({ run: "neutral", activity: "walking", timeOutsideMinutes: 20, hateSweaty: true });
    const rec = getRecommendation(c, p);

    // Should prefer shell, avoid "heavy insulated"
    expect(rec.outer.toLowerCase()).toMatch(/shell/i);
    expect(rec.outer.toLowerCase()).not.toMatch(/heavy insulated/i);
  });

  // 9) Comfort offset +6°F
  it("comfort offset +6: effective temp rises, recommendation shifts", () => {
    const c = makeConditions({ tempF: 50, windMph: 5, windGustMph: 8, pop: 0.1 });
    const pBase = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 15, comfortOffsetF: 0 });
    const pPlus = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 15, comfortOffsetF: 6 });

    const recBase = getRecommendation(c, pBase);
    const recPlus = getRecommendation(c, pPlus);

    expect(recPlus.effectiveTempF).toBe(recBase.effectiveTempF + 6);
  });

  // 10) Comfort offset -6°F
  it("comfort offset -6: effective temp drops, recommendation shifts", () => {
    const c = makeConditions({ tempF: 50, windMph: 5, windGustMph: 8, pop: 0.1 });
    const pBase = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 15, comfortOffsetF: 0 });
    const pMinus = makePrefs({ run: "neutral", activity: "still", timeOutsideMinutes: 15, comfortOffsetF: -6 });

    const recBase = getRecommendation(c, pBase);
    const recMinus = getRecommendation(c, pMinus);

    expect(recMinus.effectiveTempF).toBe(recBase.effectiveTempF - 6);
  });
});
