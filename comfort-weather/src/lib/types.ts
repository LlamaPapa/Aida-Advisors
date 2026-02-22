// ── Weather API types ──

export interface HourlyWeather {
  dt: number;
  temp: number; // °F (imperial from API)
  feels_like: number;
  wind_speed: number; // mph
  wind_gust?: number;
  pop: number; // 0–1
  rain?: { "1h": number }; // mm
  snow?: { "1h": number }; // mm
  weather: { id: number; main: string; icon: string }[];
}

export interface CurrentWeather extends HourlyWeather {
  sunrise: number;
  sunset: number;
}

export interface WeatherData {
  lat: number;
  lon: number;
  current: CurrentWeather;
  hourly: HourlyWeather[];
}

// ── Conditions snapshot passed to rule engine ──

export interface Conditions {
  tempF: number;
  feelsLikeF: number;
  windMph: number;
  windGustMph: number;
  pop: number; // 0–1
  rainMm: number;
  snowMm: number;
  isDaytime: boolean;
}

// ── User preferences ──

export type TimeOutsideMinutes = 5 | 15 | 30 | 60;
export type Activity = "still" | "walking" | "workout";
export type RunTemp = "cold" | "neutral" | "hot";
export type Units = "F" | "C";

export interface Prefs {
  units: Units;
  timeOutsideMinutes: TimeOutsideMinutes;
  activity: Activity;
  run: RunTemp;
  hateSweaty: boolean;
  comfortOffsetF: number;
}

export const DEFAULT_PREFS: Prefs = {
  units: "F",
  timeOutsideMinutes: 30,
  activity: "walking",
  run: "neutral",
  hateSweaty: false,
  comfortOffsetF: 0,
};

// ── Recommendation output ──

export interface Recommendation {
  effectiveTempF: number;
  base: string;
  mid: string;
  outer: string;
  extras: string[];
  why: string;
}

// ── Feedback ──

export interface FeedbackEvent {
  timestamp: number;
  conditions: Conditions;
  prefs: Prefs;
  recommendation: Recommendation;
  feedback: "too_cold" | "good" | "too_hot";
}
