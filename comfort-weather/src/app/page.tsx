"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  WeatherData,
  ConditionInputs,
  PrefsInputs,
  Recommendation,
  TimeOutside,
  Activity,
  RunsTemp,
  UserPrefs,
  FeedbackEvent,
} from "@/lib/types";
import { getRecommendation } from "@/lib/rules";
import { loadPrefs, loadComfortOffset, saveComfortOffset, saveFeedbackEvent } from "@/lib/storage";
import { fetchWeatherClient } from "@/lib/weather-client";
import WeatherStrip from "@/components/WeatherStrip";
import RecommendationCard from "@/components/RecommendationCard";
import FeedbackButtons from "@/components/FeedbackButtons";
import LocationSearch from "@/components/LocationSearch";

function tempDisplay(tempF: number, units: "F" | "C"): string {
  if (units === "C") return `${Math.round((tempF - 32) * 5 / 9)}°C`;
  return `${Math.round(tempF)}°F`;
}

function windDisplay(mph: number): string {
  return `${Math.round(mph)} mph`;
}

export default function Home() {
  const [prefs, setPrefs] = useState<UserPrefs | null>(null);
  const [comfortOffset, setComfortOffset] = useState(0);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [locationName, setLocationName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [geoFailed, setGeoFailed] = useState(false);

  // Inputs
  const [timeOutside, setTimeOutside] = useState<TimeOutside>(30);
  const [activity, setActivity] = useState<Activity>("walking");
  const [runsTemp, setRunsTemp] = useState<RunsTemp>("neutral");
  const [hateSweaty, setHateSweaty] = useState(false);

  // Load prefs on mount
  useEffect(() => {
    const p = loadPrefs();
    setPrefs(p);
    setTimeOutside(p.defaultTimeOutside);
    setRunsTemp(p.defaultRunsTemp);
    setComfortOffset(loadComfortOffset());
  }, []);

  // Fetch weather for coords
  const fetchForCoords = useCallback(async (lat: number, lon: number, name?: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchWeatherClient(lat, lon);
      setWeather(data);
      if (name) setLocationName(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch weather");
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-locate on mount
  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoFailed(true);
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        fetchForCoords(pos.coords.latitude, pos.coords.longitude, "Current Location");
      },
      () => {
        setGeoFailed(true);
        setLoading(false);
      },
      { timeout: 10000 }
    );
  }, [fetchForCoords]);

  // Compute recommendation
  let rec: Recommendation | null = null;
  let conditions: ConditionInputs | null = null;

  if (weather && prefs) {
    const c = weather.current;
    conditions = {
      temp: c.temp,
      feelsLike: c.feels_like,
      windSpeed: c.wind_speed,
      windGust: c.wind_gust ?? 0,
      pop: weather.hourly[0]?.pop ?? 0,
      rainIntensity: c.rain?.["1h"] ?? 0,
      snowIntensity: c.snow?.["1h"] ?? 0,
      isDaytime: c.dt >= c.sunrise && c.dt <= c.sunset,
    };

    const prefsInputs: PrefsInputs = {
      timeOutside,
      activity,
      runsTemp,
      hateSweaty,
      comfortOffsetF: comfortOffset,
    };

    rec = getRecommendation(conditions, prefsInputs);
  }

  const handleFeedback = (fb: "too_cold" | "good" | "too_hot") => {
    if (!conditions || !rec) return;

    const prefsInputs: PrefsInputs = {
      timeOutside,
      activity,
      runsTemp,
      hateSweaty,
      comfortOffsetF: comfortOffset,
    };

    const event: FeedbackEvent = {
      timestamp: Date.now(),
      conditions,
      prefs: prefsInputs,
      recommendation: rec,
      feedback: fb,
    };
    saveFeedbackEvent(event);

    let newOffset = comfortOffset;
    if (fb === "too_cold") newOffset += 2;
    if (fb === "too_hot") newOffset -= 2;
    newOffset = Math.max(-10, Math.min(10, newOffset));
    setComfortOffset(newOffset);
    saveComfortOffset(newOffset);
  };

  const handleManualLocation = (lat: number, lon: number, name: string) => {
    setGeoFailed(false);
    fetchForCoords(lat, lon, name);
  };

  const units = prefs?.units ?? "F";

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Comfort Weather</h1>
          <Link
            href="/settings"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Settings
          </Link>
        </div>

        {/* Location */}
        {locationName && !geoFailed && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{locationName}</p>
            <button
              onClick={() => setGeoFailed(true)}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Change
            </button>
          </div>
        )}

        {geoFailed && (
          <div className="space-y-2">
            <p className="text-sm text-gray-400">Enter your location:</p>
            <LocationSearch onLocate={handleManualLocation} />
          </div>
        )}

        {/* Loading / Error */}
        {loading && (
          <div className="text-center py-8 text-gray-400">Loading weather...</div>
        )}
        {error && (
          <div className="text-center py-4 text-red-400 text-sm">{error}</div>
        )}

        {/* Current conditions */}
        {weather && !loading && (
          <>
            <div className="rounded-xl bg-white/10 backdrop-blur p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-3xl font-bold">
                  {tempDisplay(weather.current.temp, units)}
                </span>
                <span className="text-sm text-gray-400">
                  Feels {tempDisplay(weather.current.feels_like, units)}
                </span>
              </div>
              <div className="flex gap-4 text-sm text-gray-400">
                <span>Wind: {windDisplay(weather.current.wind_speed)}</span>
                {weather.current.wind_gust && (
                  <span>Gusts: {windDisplay(weather.current.wind_gust)}</span>
                )}
              </div>
            </div>

            {/* Hourly strip */}
            <div>
              <h3 className="text-sm text-gray-400 mb-2">Next 8 hours</h3>
              <WeatherStrip hourly={weather.hourly} units={units} />
            </div>

            {/* Controls */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* Time outside */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Time outside</label>
                  <select
                    value={timeOutside}
                    onChange={(e) => setTimeOutside(Number(e.target.value) as TimeOutside)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
                  >
                    <option value={5}>5 min</option>
                    <option value={15}>15 min</option>
                    <option value={30}>30 min</option>
                    <option value={60}>60+ min</option>
                  </select>
                </div>

                {/* Activity */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Activity</label>
                  <select
                    value={activity}
                    onChange={(e) => setActivity(e.target.value as Activity)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
                  >
                    <option value="still">Still</option>
                    <option value="walking">Walking</option>
                    <option value="workout">Workout</option>
                  </select>
                </div>

                {/* I run */}
                <div>
                  <label className="text-xs text-gray-400 block mb-1">I run...</label>
                  <select
                    value={runsTemp}
                    onChange={(e) => setRunsTemp(e.target.value as RunsTemp)}
                    className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
                  >
                    <option value="cold">Cold</option>
                    <option value="neutral">Neutral</option>
                    <option value="hot">Hot</option>
                  </select>
                </div>

                {/* Hate sweaty */}
                <div className="flex items-end pb-1">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hateSweaty}
                      onChange={(e) => setHateSweaty(e.target.checked)}
                      className="rounded"
                    />
                    Hate being sweaty
                  </label>
                </div>
              </div>
            </div>

            {/* Recommendation */}
            {rec && (
              <div className="space-y-3">
                <RecommendationCard rec={rec} />
                <FeedbackButtons onFeedback={handleFeedback} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
