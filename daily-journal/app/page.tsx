"use client";

import { useState, useEffect, useCallback } from "react";
import Calendar from "./components/Calendar";
import DayView from "./components/DayView";
import { JournalEntry } from "@/lib/supabase";
import { getAllEntries } from "@/lib/local-storage";

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Home() {
  const [selectedDate, setSelectedDate] = useState(todayString());
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [view, setView] = useState<"calendar" | "day">("day");

  const refreshEntries = useCallback(() => {
    setEntries(getAllEntries());
  }, []);

  useEffect(() => {
    refreshEntries();
  }, [refreshEntries]);

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setView("day");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-100 sticky top-0 z-10">
        <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Daily Journal</h1>
          <button
            onClick={() => setView(view === "calendar" ? "day" : "calendar")}
            className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
          >
            {view === "calendar" ? (
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                />
              </svg>
            ) : (
              <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            )}
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-md mx-auto px-4 py-6">
        {view === "calendar" ? (
          <Calendar
            entries={entries}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
          />
        ) : (
          <>
            <DayView
              date={selectedDate}
              onEntrySaved={refreshEntries}
            />
            <div className="mt-6 flex justify-center">
              <button
                onClick={() => {
                  setSelectedDate(todayString());
                }}
                className="text-sm text-indigo-600 font-medium hover:text-indigo-700 transition-colors"
              >
                Go to Today
              </button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
