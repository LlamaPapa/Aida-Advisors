"use client";

import { useState, useEffect, useCallback } from "react";
import { JournalEntry } from "@/lib/supabase";
import { getEntriesForDate, upsertEntry } from "@/lib/local-storage";
import VoiceRecorder from "./VoiceRecorder";

type Props = {
  date: string;
  onEntrySaved: () => void;
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]}, ${MONTHS[date.getMonth()]} ${d}, ${y}`;
}

function isToday(dateStr: string): boolean {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return dateStr === todayStr;
}

export default function DayView({ date, onEntrySaved }: Props) {
  const [morningText, setMorningText] = useState("");
  const [eveningText, setEveningText] = useState("");
  const [existingMorning, setExistingMorning] = useState<JournalEntry | null>(null);
  const [existingEvening, setExistingEvening] = useState<JournalEntry | null>(null);
  const [savedMessage, setSavedMessage] = useState("");

  const loadEntries = useCallback(() => {
    const entries = getEntriesForDate(date);
    const morning = entries.find((e) => e.time_of_day === "morning") || null;
    const evening = entries.find((e) => e.time_of_day === "evening") || null;
    setExistingMorning(morning);
    setExistingEvening(evening);
    setMorningText(morning?.content || "");
    setEveningText(evening?.content || "");
  }, [date]);

  useEffect(() => {
    loadEntries();
    setSavedMessage("");
  }, [loadEntries]);

  const saveMorning = () => {
    if (!morningText.trim()) return;
    upsertEntry({ date, time_of_day: "morning", content: morningText.trim() });
    setSavedMessage("Morning entry saved!");
    loadEntries();
    onEntrySaved();
    setTimeout(() => setSavedMessage(""), 2000);
  };

  const saveEvening = () => {
    if (!eveningText.trim()) return;
    upsertEntry({ date, time_of_day: "evening", content: eveningText.trim() });
    setSavedMessage("Evening entry saved!");
    loadEntries();
    onEntrySaved();
    setTimeout(() => setSavedMessage(""), 2000);
  };

  const todayLabel = isToday(date);

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {todayLabel ? "Today" : formatDisplayDate(date)}
        </h2>
        {todayLabel && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{formatDisplayDate(date)}</p>
        )}
      </div>

      {savedMessage && (
        <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-center py-2 px-4 rounded-xl text-sm font-medium animate-fade-in">
          {savedMessage}
        </div>
      )}

      {/* Morning Entry */}
      <div className="bg-amber-50 dark:bg-amber-950/40 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">&#9788;</span>
          <h3 className="font-semibold text-amber-900 dark:text-amber-200">Morning Reflection</h3>
          {existingMorning && (
            <span className="ml-auto text-xs bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 px-2 py-0.5 rounded-full">
              Saved
            </span>
          )}
        </div>
        <p className="text-sm text-amber-700 dark:text-amber-300/80">
          Start your day with something positive.
        </p>
        <VoiceRecorder
          value={morningText}
          onChange={setMorningText}
          onSave={saveMorning}
          placeholder="What are you grateful for this morning?"
        />
      </div>

      {/* Evening Entry */}
      <div className="bg-indigo-50 dark:bg-indigo-950/40 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl">&#9790;</span>
          <h3 className="font-semibold text-indigo-900 dark:text-indigo-200">Evening Reflection</h3>
          {existingEvening && (
            <span className="ml-auto text-xs bg-indigo-200 dark:bg-indigo-800 text-indigo-800 dark:text-indigo-200 px-2 py-0.5 rounded-full">
              Saved
            </span>
          )}
        </div>
        <p className="text-sm text-indigo-700 dark:text-indigo-300/80">
          End your day on a positive note.
        </p>
        <VoiceRecorder
          value={eveningText}
          onChange={setEveningText}
          onSave={saveEvening}
          placeholder="What was the best part of your day?"
        />
      </div>
    </div>
  );
}
