import { Prefs, DEFAULT_PREFS, FeedbackEvent } from "./types";

const PREFS_KEY = "cw_prefs_v1";
const FEEDBACK_KEY = "cw_feedback_v1";

// ── Preferences (includes comfortOffsetF) ──

export function loadPrefs(): Prefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(prefs: Prefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function updateComfortOffset(delta: number): number {
  const prefs = loadPrefs();
  const clamped = Math.max(-10, Math.min(10, prefs.comfortOffsetF + delta));
  savePrefs({ ...prefs, comfortOffsetF: clamped });
  return clamped;
}

export function resetLearning(): void {
  const prefs = loadPrefs();
  savePrefs({ ...prefs, comfortOffsetF: 0 });
  localStorage.removeItem(FEEDBACK_KEY);
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
  const trimmed = events.slice(-100);
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(trimmed));
}
