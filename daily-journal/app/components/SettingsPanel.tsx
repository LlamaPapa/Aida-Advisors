"use client";

import { useNotifications } from "@/lib/use-notifications";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { settings, permission, toggleNotifications, updateTimes } =
    useNotifications();

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 space-y-5 animate-fade-in">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">
            Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <svg
              className="w-5 h-5 text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Notification toggle */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                Reminders
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Get notified to journal
              </p>
            </div>
            <button
              onClick={toggleNotifications}
              className={`relative w-12 h-7 rounded-full transition-colors ${
                settings.enabled
                  ? "bg-indigo-600"
                  : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform ${
                  settings.enabled ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>

          {permission === "denied" && (
            <p className="text-sm text-red-500">
              Notifications are blocked. Please enable them in your browser
              settings.
            </p>
          )}

          {settings.enabled && (
            <div className="space-y-3 pl-1">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Morning reminder
                </span>
                <input
                  type="time"
                  value={`${pad(settings.morningHour)}:${pad(settings.morningMinute)}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    updateTimes({ morningHour: h, morningMinute: m });
                  }}
                  className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm
                    text-gray-900 dark:text-gray-100"
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  Evening reminder
                </span>
                <input
                  type="time"
                  value={`${pad(settings.eveningHour)}:${pad(settings.eveningMinute)}`}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(":").map(Number);
                    updateTimes({ eveningHour: h, eveningMinute: m });
                  }}
                  className="bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-1.5 text-sm
                    text-gray-900 dark:text-gray-100"
                />
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 dark:border-gray-800 pt-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
            Tip: Add this app to your home screen for the best experience
          </p>
        </div>
      </div>
    </div>
  );
}
