import { WeatherData, CurrentWeather, HourlyWeather } from "./types";

const API_KEY = process.env.OPENWEATHER_API_KEY ?? "";
const BASE = "https://api.openweathermap.org";

// ── Geocoding ──

interface GeoResult {
  lat: number;
  lon: number;
  name: string;
  state?: string;
  country: string;
}

export async function geocode(query: string): Promise<GeoResult | null> {
  const url = `${BASE}/geo/1.0/direct?q=${encodeURIComponent(query)}&limit=1&appid=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data: GeoResult[] = await res.json();
  return data[0] ?? null;
}

// ── One Call 3.0 ──

interface RawCurrent {
  dt: number;
  sunrise: number;
  sunset: number;
  temp: number;
  feels_like: number;
  wind_speed: number;
  wind_gust?: number;
  weather: { id: number; main: string; icon: string }[];
  rain?: { "1h": number };
  snow?: { "1h": number };
}

interface RawHourly {
  dt: number;
  temp: number;
  feels_like: number;
  wind_speed: number;
  wind_gust?: number;
  pop: number;
  weather: { id: number; main: string; icon: string }[];
  rain?: { "1h": number };
  snow?: { "1h": number };
}

interface RawOneCall {
  lat: number;
  lon: number;
  current: RawCurrent;
  hourly: RawHourly[];
}

function kelvinToF(k: number): number {
  return (k - 273.15) * 9 / 5 + 32;
}

function mpsToMph(mps: number): number {
  return mps * 2.237;
}

function convertCurrent(raw: RawCurrent): CurrentWeather {
  return {
    dt: raw.dt,
    sunrise: raw.sunrise,
    sunset: raw.sunset,
    temp: raw.temp,
    feels_like: raw.feels_like,
    wind_speed: raw.wind_speed,
    wind_gust: raw.wind_gust,
    pop: 0,
    weather: raw.weather,
    rain: raw.rain,
    snow: raw.snow,
  };
}

function convertHourly(raw: RawHourly): HourlyWeather {
  return {
    dt: raw.dt,
    temp: raw.temp,
    feels_like: raw.feels_like,
    wind_speed: raw.wind_speed,
    wind_gust: raw.wind_gust,
    pop: raw.pop,
    weather: raw.weather,
    rain: raw.rain,
    snow: raw.snow,
  };
}

export async function fetchWeather(lat: number, lon: number): Promise<WeatherData> {
  const url = `${BASE}/data/3.0/onecall?lat=${lat}&lon=${lon}&units=imperial&exclude=minutely,daily,alerts&appid=${API_KEY}`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) {
    throw new Error(`Weather API error: ${res.status} ${res.statusText}`);
  }
  const raw: RawOneCall = await res.json();
  return {
    lat: raw.lat,
    lon: raw.lon,
    current: convertCurrent(raw.current),
    hourly: raw.hourly.slice(0, 8).map(convertHourly),
  };
}
