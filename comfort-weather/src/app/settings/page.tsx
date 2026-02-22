"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Prefs, TimeOutsideMinutes, Activity, RunTemp, Units, DEFAULT_PREFS } from "@/lib/types";
import { loadPrefs, savePrefs, resetLearning } from "@/lib/storage";

export default function SettingsPage() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    setPrefs(loadPrefs());
  }, []);

  const update = <K extends keyof Prefs>(key: K, value: Prefs[K]) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePrefs(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleReset = () => {
    resetLearning();
    setPrefs((prev) => ({ ...prev, comfortOffsetF: 0 }));
    setResetDone(true);
    setTimeout(() => setResetDone(false), 2000);
  };

  const btnClass = (active: boolean) =>
    `flex-1 px-3 py-2 rounded-lg text-sm capitalize transition-colors ${
      active ? "bg-white/20 font-medium" : "bg-white/5 text-gray-400 hover:bg-white/10"
    }`;

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-800 text-white">
      <div className="max-w-md mx-auto px-4 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Settings</h1>
          <Link href="/" className="text-sm text-gray-400 hover:text-white transition-colors">
            Back
          </Link>
        </div>

        {/* Units */}
        <div>
          <label className="text-sm text-gray-400 block mb-2">Temperature units</label>
          <div className="flex gap-2">
            {(["F", "C"] as Units[]).map((u) => (
              <button key={u} onClick={() => update("units", u)} className={btnClass(prefs.units === u)}>
                &deg;{u}
              </button>
            ))}
          </div>
        </div>

        {/* Default time outside */}
        <div>
          <label className="text-sm text-gray-400 block mb-2">Default time outside</label>
          <select
            value={prefs.timeOutsideMinutes}
            onChange={(e) => update("timeOutsideMinutes", Number(e.target.value) as TimeOutsideMinutes)}
            className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
          >
            <option value={5}>5 minutes</option>
            <option value={15}>15 minutes</option>
            <option value={30}>30 minutes</option>
            <option value={60}>60+ minutes</option>
          </select>
        </div>

        {/* Default activity */}
        <div>
          <label className="text-sm text-gray-400 block mb-2">Default activity</label>
          <div className="flex gap-2">
            {(["still", "walking", "workout"] as Activity[]).map((a) => (
              <button key={a} onClick={() => update("activity", a)} className={btnClass(prefs.activity === a)}>
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* Default I run */}
        <div>
          <label className="text-sm text-gray-400 block mb-2">I typically run...</label>
          <div className="flex gap-2">
            {(["cold", "neutral", "hot"] as RunTemp[]).map((r) => (
              <button key={r} onClick={() => update("run", r)} className={btnClass(prefs.run === r)}>
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Default hate sweaty */}
        <div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={prefs.hateSweaty}
              onChange={(e) => update("hateSweaty", e.target.checked)}
              className="rounded"
            />
            Hate being sweaty (default)
          </label>
        </div>

        {/* Comfort offset display */}
        {prefs.comfortOffsetF !== 0 && (
          <p className="text-xs text-gray-500">
            Learned comfort offset: {prefs.comfortOffsetF > 0 ? "+" : ""}{prefs.comfortOffsetF}&deg;F
          </p>
        )}

        {/* Reset learning */}
        <div className="pt-2 border-t border-white/10">
          <button
            onClick={handleReset}
            className="w-full px-4 py-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-300 text-sm transition-colors"
          >
            Reset learning
          </button>
          <p className="text-xs text-gray-500 mt-1">
            Clears comfort offset and feedback history.
          </p>
          {resetDone && <p className="text-sm text-green-400 text-center mt-2">Reset complete</p>}
        </div>

        {saved && <p className="text-sm text-green-400 text-center">Saved</p>}
      </div>
    </main>
  );
}
