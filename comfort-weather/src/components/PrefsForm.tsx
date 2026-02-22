"use client";

import { TimeOutsideMinutes, Activity, RunTemp } from "@/lib/types";

interface Props {
  timeOutsideMinutes: TimeOutsideMinutes;
  activity: Activity;
  run: RunTemp;
  hateSweaty: boolean;
  onTimeChange: (v: TimeOutsideMinutes) => void;
  onActivityChange: (v: Activity) => void;
  onRunChange: (v: RunTemp) => void;
  onHateSweatyChange: (v: boolean) => void;
}

export default function PrefsForm({
  timeOutsideMinutes,
  activity,
  run,
  hateSweaty,
  onTimeChange,
  onActivityChange,
  onRunChange,
  onHateSweatyChange,
}: Props) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="text-xs text-gray-400 block mb-1">Time outside</label>
        <select
          value={timeOutsideMinutes}
          onChange={(e) => onTimeChange(Number(e.target.value) as TimeOutsideMinutes)}
          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
        >
          <option value={5}>5 min</option>
          <option value={15}>15 min</option>
          <option value={30}>30 min</option>
          <option value={60}>60+ min</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">Activity</label>
        <select
          value={activity}
          onChange={(e) => onActivityChange(e.target.value as Activity)}
          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
        >
          <option value="still">Still</option>
          <option value="walking">Walking</option>
          <option value="workout">Workout</option>
        </select>
      </div>

      <div>
        <label className="text-xs text-gray-400 block mb-1">I run...</label>
        <select
          value={run}
          onChange={(e) => onRunChange(e.target.value as RunTemp)}
          className="w-full px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm focus:outline-none"
        >
          <option value="cold">Cold</option>
          <option value="neutral">Neutral</option>
          <option value="hot">Hot</option>
        </select>
      </div>

      <div className="flex items-end pb-1">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={hateSweaty}
            onChange={(e) => onHateSweatyChange(e.target.checked)}
            className="rounded"
          />
          Hate being sweaty
        </label>
      </div>
    </div>
  );
}
