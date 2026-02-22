import { WeatherData, CurrentWeather, HourlyWeather } from "./types";

interface RawOneCall {
  lat: number;
  lon: number;
  current: {
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
  };
  hourly: {
    dt: number;
    temp: number;
    feels_like: number;
    wind_speed: number;
    wind_gust?: number;
    pop: number;
    weather: { id: number; main: string; icon: string }[];
    rain?: { "1h": number };
    snow?: { "1h": number };
  }[];
}

export async function fetchWeatherClient(
  lat: number,
  lon: number
): Promise<WeatherData> {
  const res = await fetch(`/api/weather?lat=${lat}&lon=${lon}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error ?? `API error ${res.status}`);
  }
  const raw: RawOneCall = await res.json();

  const current: CurrentWeather = {
    dt: raw.current.dt,
    sunrise: raw.current.sunrise,
    sunset: raw.current.sunset,
    temp: raw.current.temp,
    feels_like: raw.current.feels_like,
    wind_speed: raw.current.wind_speed,
    wind_gust: raw.current.wind_gust,
    pop: 0,
    weather: raw.current.weather,
    rain: raw.current.rain,
    snow: raw.current.snow,
  };

  const hourly: HourlyWeather[] = raw.hourly.slice(0, 8).map((h) => ({
    dt: h.dt,
    temp: h.temp,
    feels_like: h.feels_like,
    wind_speed: h.wind_speed,
    wind_gust: h.wind_gust,
    pop: h.pop,
    weather: h.weather,
    rain: h.rain,
    snow: h.snow,
  }));

  return { lat: raw.lat, lon: raw.lon, current, hourly };
}

interface GeoResult {
  lat: number;
  lon: number;
  name: string;
  state?: string;
  country: string;
}

export async function geocodeClient(query: string): Promise<GeoResult> {
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Location not found" }));
    throw new Error(err.error ?? "Location not found");
  }
  return res.json();
}
