"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  WeatherData,
  Conditions,
  Prefs,
  Recommendation,
  TimeOutsideMinutes,
  Activity,
  RunTemp,
  FeedbackEvent,
} from "@/lib/types";
import { getRecommendation } from "@/lib/rules";
import { loadPrefs, savePrefs, updateComfortOffset, saveFeedbackEvent } from "@/lib/storage";
import { fetchWeatherClient } from "@/lib/openweather";
import { tempDisplay } from "@/lib/units";
import HourlyStrip from "@/components/HourlyStrip";
import RecommendationCard from "@/components/RecommendationCard";
import FeedbackButtons from "@/components/FeedbackButtons";
import LocationPicker from "@/components/LocationPicker";
import PrefsForm from "@/components/PrefsForm";

export default function Home() {
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [locationName, setLocationName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [geoFailed, setGeoFailed] = useState(false);

  // Session-level overrides (initialized from prefs on mount)
  const [timeOutsideMinutes, setTimeOutsideMinutes] = useState<TimeOutsideMinutes>(30);
  const [activity, setActivity] = useState<Activity>("walking");
  const [run, setRun] = useState<RunTemp>("neutral");
  const [hateSweaty, setHateSweaty] = useState(false);

  useEffect(() => {
    const p = loadPrefs();
    setPrefs(p);
    setTimeOutsideMinutes(p.timeOutsideMinutes);
    setActivity(p.activity);
    setRun(p.run);
    setHateSweaty(p.hateSweaty);
  }, []);

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

  useEffect(() => {
    if (!navigator.geolocation) {
      setGeoFailed(true);
      setLoading(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchForCoords(pos.coords.latitude, pos.coords.longitude, "Current Location"),
      () => { setGeoFailed(true); setLoading(false); },
      { timeout: 10000 }
    );
  }, [fetchForCoords]);

  // Build conditions + active prefs for the rule engine
  let rec: Recommendation | null = null;
  let conditions: Conditions | null = null;
  let activePrefs: Prefs | null = null;

  if (weather && prefs) {
    const c = weather.current;
    conditions = {
      tempF: c.temp,
      feelsLikeF: c.feels_like,
      windMph: c.wind_speed,
      windGustMph: c.wind_gust ?? 0,
      pop: weather.hourly[0]?.pop ?? 0,
      rainMm: c.rain?.["1h"] ?? 0,
      snowMm: c.snow?.["1h"] ?? 0,
      isDaytime: c.dt >= c.sunrise && c.dt <= c.sunset,
    };
    activePrefs = {
      ...prefs,
      timeOutsideMinutes,
      activity,
      run,
      hateSweaty,
    };
    rec = getRecommendation(conditions, activePrefs);
  }

  const handleFeedback = (fb: "too_cold" | "good" | "too_hot") => {
    if (!conditions || !rec || !activePrefs) return;

    const event: FeedbackEvent = {
      timestamp: Date.now(),
      conditions,
      prefs: activePrefs,
      recommendation: rec,
      feedback: fb,
    };
    saveFeedbackEvent(event);

    const delta = fb === "too_cold" ? 2 : fb === "too_hot" ? -2 : 0;
    if (delta !== 0) {
      const newOffset = updateComfortOffset(delta);
      setPrefs((prev) => prev ? { ...prev, comfortOffsetF: newOffset } : prev);
    }
  };

  const handleManualLocation = (lat: number, lon: number, name: string) => {
    setGeoFailed(false);
    fetchForCoords(lat, lon, name);
  };

  const units = prefs?.units ?? "F";

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
      <div className="max-w-md mx-auto px-4 py-6 space-y-5">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Comfort Weather</h1>
          <Link href="/settings" className="text-sm text-gray-400 hover:text-white transition-colors">
            Settings
          </Link>
        </div>

        {locationName && !geoFailed && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-400">{locationName}</p>
            <button onClick={() => setGeoFailed(true)} className="text-xs text-gray-500 hover:text-gray-300">
              Change
            </button>
          </div>
        )}

        {geoFailed && (
          <div className="space-y-2">
            <p className="text-sm text-gray-400">Enter your location:</p>
            <LocationPicker onLocate={handleManualLocation} />
          </div>
        )}

        {loading && <div className="text-center py-8 text-gray-400">Loading weather...</div>}
        {error && <div className="text-center py-4 text-red-400 text-sm">{error}</div>}

        {weather && !loading && (
          <>
            <div className="rounded-xl bg-white/10 backdrop-blur p-4">
              <div className="flex items-baseline justify-between mb-1">
                <span className="text-3xl font-bold">{tempDisplay(weather.current.temp, units)}</span>
                <span className="text-sm text-gray-400">
                  Feels {tempDisplay(weather.current.feels_like, units)}
                </span>
              </div>
              <div className="flex gap-4 text-sm text-gray-400">
                <span>Wind: {Math.round(weather.current.wind_speed)} mph</span>
                {weather.current.wind_gust && (
                  <span>Gusts: {Math.round(weather.current.wind_gust)} mph</span>
                )}
              </div>
            </div>

            <div>
              <h3 className="text-sm text-gray-400 mb-2">Next 8 hours</h3>
              <HourlyStrip hourly={weather.hourly} units={units} />
            </div>

            <PrefsForm
              timeOutsideMinutes={timeOutsideMinutes}
              activity={activity}
              run={run}
              hateSweaty={hateSweaty}
              onTimeChange={setTimeOutsideMinutes}
              onActivityChange={setActivity}
              onRunChange={setRun}
              onHateSweatyChange={setHateSweaty}
            />

            {rec && (
              <div className="space-y-3">
                <RecommendationCard rec={rec} units={units} />
                <FeedbackButtons onFeedback={handleFeedback} />
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
