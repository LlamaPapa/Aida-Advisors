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

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

type EntryCardProps = {
  icon: string;
  title: string;
  subtitle: string;
  placeholder: string;
  entry: JournalEntry | null;
  text: string;
  onTextChange: (v: string) => void;
  onSave: () => void;
  theme: "morning" | "evening";
};

function EntryCard({
  icon,
  title,
  subtitle,
  placeholder,
  entry,
  text,
  onTextChange,
  onSave,
  theme,
}: EntryCardProps) {
  const [editing, setEditing] = useState(false);
  const isSaved = !!entry;

  // Reset editing state when entry changes (e.g. navigating to a different day)
  useEffect(() => {
    setEditing(false);
  }, [entry?.date]);

  const handleSave = () => {
    onSave();
    setEditing(false);
  };

  const handleEdit = () => {
    setEditing(true);
  };

  const isMorning = theme === "morning";
  const bgClass = isMorning ? "bg-amber-50 dark:bg-amber-950/40" : "bg-indigo-50 dark:bg-indigo-950/40";
  const titleClass = isMorning ? "text-amber-900 dark:text-amber-200" : "text-indigo-900 dark:text-indigo-200";
  const subtitleClass = isMorning ? "text-amber-700 dark:text-amber-300/80" : "text-indigo-700 dark:text-indigo-300/80";
  const savedBgClass = isMorning
    ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
    : "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300";
  const textBgClass = isMorning
    ? "bg-amber-100/60 dark:bg-amber-900/30"
    : "bg-indigo-100/60 dark:bg-indigo-900/30";
  const textColorClass = isMorning
    ? "text-amber-950 dark:text-amber-100"
    : "text-indigo-950 dark:text-indigo-100";
  const editBtnClass = isMorning
    ? "text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40"
    : "text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/40";

  // Saved state: show read-only entry
  if (isSaved && !editing) {
    return (
      <div className={`${bgClass} rounded-2xl p-5 space-y-3`}>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{icon}</span>
          <h3 className={`font-semibold ${titleClass}`}>{title}</h3>
          <span className={`ml-auto text-xs ${savedBgClass} px-2 py-0.5 rounded-full font-medium`}>
            Saved
          </span>
        </div>

        {/* Saved text display */}
        <div className={`${textBgClass} rounded-xl p-4`}>
          <p className={`text-base leading-relaxed ${textColorClass}`}>
            {entry.content}
          </p>
        </div>

        {/* Timestamp + Edit */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-gray-500">
            Saved at {formatTime(entry.created_at!)}
          </span>
          <button
            onClick={handleEdit}
            className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${editBtnClass}`}
          >
            Edit
          </button>
        </div>
      </div>
    );
  }

  // Editing / new entry state
  return (
    <div className={`${bgClass} rounded-2xl p-5 space-y-3`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icon}</span>
        <h3 className={`font-semibold ${titleClass}`}>{title}</h3>
        {editing && (
          <button
            onClick={() => {
              onTextChange(entry?.content || "");
              setEditing(false);
            }}
            className="ml-auto text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded-lg transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
      <p className={`text-sm ${subtitleClass}`}>{subtitle}</p>
      <VoiceRecorder
        value={text}
        onChange={onTextChange}
        onSave={handleSave}
        placeholder={placeholder}
      />
    </div>
  );
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

      <EntryCard
        icon="&#9788;"
        title="Morning Reflection"
        subtitle="Start your day with something positive."
        placeholder="What are you grateful for this morning?"
        entry={existingMorning}
        text={morningText}
        onTextChange={setMorningText}
        onSave={saveMorning}
        theme="morning"
      />

      <EntryCard
        icon="&#9790;"
        title="Evening Reflection"
        subtitle="End your day on a positive note."
        placeholder="What was the best part of your day?"
        entry={existingEvening}
        text={eveningText}
        onTextChange={setEveningText}
        onSave={saveEvening}
        theme="evening"
      />
    </div>
  );
}
