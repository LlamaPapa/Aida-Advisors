"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { UserPrefs, TimeOutside, RunsTemp, Units, DEFAULT_PREFS } from "@/lib/types";
import { loadPrefs, savePrefs } from "@/lib/storage";

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<UserPrefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const update = <K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePrefs(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
      <div className="max-w-md mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Settings</h1>
          <Link
            href="/"
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            Back
          </Link>
        </div>

        {/* Units */}
        <div>
          <label className="text-sm text-gray-400 block mb-2">Temperature units</label>
          <div className="flex gap-2">
            {(["F", "C"] as Units[]).map((u) => (
              <button
                key={u}
                onClick={() => update("units", u)}
                className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                  prefs.units === u
                    ? "bg-white/20 font-medium"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                °{u}
              </button>
            ))}
          </div>
        </div>

        {/* Default time outside */}
        <div>
          <label className="text-sm text-gray-400 block mb-2">Default time outside</label>
          <select
            value={prefs.defaultTimeOutside}
            onChange={(e) => update("defaultTimeOutside", Number(e.target.value) as TimeOutside)}
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
          >
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60+ minutes</option>
          </select>
        </div>

        {/* Default "I run" */}
        <div>
          <label className="text-sm text-gray-400 block mb-2">I typically run...</label>
          <div className="flex gap-2">
            {(["cold", "neutral", "hot"] as RunsTemp[]).map((r) => (
              <button
                key={r}
                onClick={() => update("defaultRunsTemp", r)}
                className={`flex-1 px-3 py-2 rounded-lg text-sm capitalize transition-colors ${
                  prefs.defaultRunsTemp === r
                    ? "bg-white/20 font-medium"
                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {saved && (
          <p className="text-sm text-green-400 text-center">Saved</p>
        )}
      </div>
    </main>
  );
}
