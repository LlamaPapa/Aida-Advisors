"use client";

import { useState, useMemo } from "react";
import { JournalEntry } from "@/lib/supabase";

type Props = {
  entries: JournalEntry[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function Calendar({ entries, selectedDate, onSelectDate }: Props) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());

  const entryMap = useMemo(() => {
    const map: Record<string, { morning: boolean; evening: boolean }> = {};
    for (const e of entries) {
      if (!map[e.date]) map[e.date] = { morning: false, evening: false };
      map[e.date][e.time_of_day] = true;
    }
    return map;
  }, [entries]);

  const firstDay = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  };

  const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate());

  return (
    <div className="w-full max-w-md mx-auto">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={prevMonth}
          className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label="Previous month"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h2 className="text-lg font-semibold">
          {MONTHS[viewMonth]} {viewYear}
        </h2>
        <button
          onClick={nextMonth}
          className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label="Next month"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-xs font-medium text-gray-500 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-1">
        {/* Empty cells for days before the 1st */}
        {Array.from({ length: firstDay }).map((_, i) => (
          <div key={`empty-${i}`} className="aspect-square" />
        ))}

        {/* Day cells */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = formatDate(viewYear, viewMonth, day);
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const entry = entryMap[dateStr];
          const hasMorning = entry?.morning;
          const hasEvening = entry?.evening;
          const hasAny = hasMorning || hasEvening;
          const hasBoth = hasMorning && hasEvening;

          return (
            <button
              key={day}
              onClick={() => onSelectDate(dateStr)}
              className={`
                aspect-square rounded-lg flex flex-col items-center justify-center relative transition-all
                ${isSelected ? "bg-indigo-600 text-white shadow-md" : ""}
                ${isToday && !isSelected ? "ring-2 ring-indigo-400" : ""}
                ${!isSelected ? "hover:bg-gray-100 active:bg-gray-200" : ""}
              `}
            >
              <span className={`text-sm ${hasAny && !isSelected ? "font-semibold" : ""}`}>
                {day}
              </span>
              {/* Entry indicators */}
              {hasAny && (
                <div className="flex gap-0.5 mt-0.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected
                        ? hasMorning ? "bg-yellow-300" : "bg-white/30"
                        : hasMorning ? "bg-amber-400" : "bg-gray-200"
                    }`}
                  />
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isSelected
                        ? hasEvening ? "bg-blue-300" : "bg-white/30"
                        : hasEvening ? "bg-indigo-400" : "bg-gray-200"
                    }`}
                  />
                </div>
              )}
              {hasBoth && (
                <div
                  className={`absolute top-0.5 right-0.5 w-2 h-2 rounded-full ${
                    isSelected ? "bg-green-300" : "bg-green-400"
                  }`}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-4 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400" />
          Morning
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-indigo-400" />
          Evening
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-400" />
          Both
        </div>
      </div>
    </div>
  );
}
