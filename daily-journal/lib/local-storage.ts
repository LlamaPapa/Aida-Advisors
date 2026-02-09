import { JournalEntry } from "./supabase";

const STORAGE_KEY = "daily-journal-entries";

function getAll(): JournalEntry[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function save(entries: JournalEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function getEntriesForDate(date: string): JournalEntry[] {
  return getAll().filter((e) => e.date === date);
}

export function getAllEntries(): JournalEntry[] {
  return getAll();
}

export function upsertEntry(entry: JournalEntry): JournalEntry {
  const entries = getAll();
  const idx = entries.findIndex(
    (e) => e.date === entry.date && e.time_of_day === entry.time_of_day
  );
  const saved = {
    ...entry,
    id: entry.id || crypto.randomUUID(),
    created_at: new Date().toISOString(),
  };
  if (idx >= 0) {
    entries[idx] = saved;
  } else {
    entries.push(saved);
  }
  save(entries);
  return saved;
}

export function getEntriesForMonth(year: number, month: number): JournalEntry[] {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  return getAll().filter((e) => e.date.startsWith(prefix));
}
