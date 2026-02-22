import { UserPrefs, DEFAULT_PREFS, FeedbackEvent } from "./types";

const PREFS_KEY = "comfort-weather-prefs";
const OFFSET_KEY = "comfort-weather-offset";
const FEEDBACK_KEY = "comfort-weather-feedback";

// ── Preferences ──

export function loadPrefs(): UserPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: UserPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

// ── Comfort offset ──

export function loadComfortOffset(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(OFFSET_KEY);
    return raw ? Number(raw) : 0;
  } catch {
    return 0;
  }
}

export function saveComfortOffset(offset: number): void {
  const clamped = Math.max(-10, Math.min(10, offset));
  localStorage.setItem(OFFSET_KEY, String(clamped));
}

// ── Feedback log ──

export function loadFeedback(): FeedbackEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(FEEDBACK_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveFeedbackEvent(event: FeedbackEvent): void {
  const events = loadFeedback();
  events.push(event);
  // Keep last 100 events
  const trimmed = events.slice(-100);
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(trimmed));
}
