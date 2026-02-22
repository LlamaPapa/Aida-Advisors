// ── Weather API types ──

export interface HourlyWeather {
  dt: number;
  temp: number; // °F (converted from API)
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
  hourly: HourlyWeather[]; // next 48h from API; we use first 8
}

// ── User preferences ──

export type TimeOutside = 5 | 15 | 30 | 60;
export type Activity = "still" | "walking" | "workout";
export type RunsTemp = "cold" | "neutral" | "hot";
export type Units = "F" | "C";

export interface UserPrefs {
  units: Units;
  defaultTimeOutside: TimeOutside;
  defaultRunsTemp: RunsTemp;
}

export const DEFAULT_PREFS: UserPrefs = {
  units: "F",
  defaultTimeOutside: 30,
  defaultRunsTemp: "neutral",
};

// ── Recommendation ──

export interface Recommendation {
  base: string;
  mid: string;
  outer: string;
  extras: string;
  why: string;
}

export interface ConditionInputs {
  temp: number; // °F
  feelsLike: number;
  windSpeed: number;
  windGust: number;
  pop: number;
  rainIntensity: number; // mm/h
  snowIntensity: number;
  isDaytime: boolean;
}

export interface PrefsInputs {
  timeOutside: TimeOutside;
  activity: Activity;
  runsTemp: RunsTemp;
  hateSweaty: boolean;
  comfortOffsetF: number;
}

// ── Feedback ──

export interface FeedbackEvent {
  timestamp: number;
  conditions: ConditionInputs;
  prefs: PrefsInputs;
  recommendation: Recommendation;
  feedback: "too_cold" | "good" | "too_hot";
}
