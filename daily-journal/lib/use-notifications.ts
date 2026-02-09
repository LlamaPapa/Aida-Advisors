"use client";

import { useEffect, useState, useCallback } from "react";

const MORNING_HOUR = 7;
const MORNING_MINUTE = 0;
const EVENING_HOUR = 21;
const EVENING_MINUTE = 0;

const STORAGE_KEY = "journal-notification-settings";

type NotificationSettings = {
  enabled: boolean;
  morningHour: number;
  morningMinute: number;
  eveningHour: number;
  eveningMinute: number;
};

function getSettings(): NotificationSettings {
  if (typeof window === "undefined") {
    return {
      enabled: false,
      morningHour: MORNING_HOUR,
      morningMinute: MORNING_MINUTE,
      eveningHour: EVENING_HOUR,
      eveningMinute: EVENING_MINUTE,
    };
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) return JSON.parse(raw);
  return {
    enabled: false,
    morningHour: MORNING_HOUR,
    morningMinute: MORNING_MINUTE,
    eveningHour: EVENING_HOUR,
    eveningMinute: EVENING_MINUTE,
  };
}

function saveSettings(settings: NotificationSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function scheduleLocalNotification(
  title: string,
  body: string,
  hour: number,
  minute: number,
  tag: string
) {
  const now = new Date();
  const target = new Date();
  target.setHours(hour, minute, 0, 0);

  // If the time has already passed today, schedule for tomorrow
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  const delay = target.getTime() - now.getTime();

  return setTimeout(() => {
    if (Notification.permission === "granted") {
      navigator.serviceWorker?.ready.then((reg) => {
        reg.showNotification(title, {
          body,
          icon: "/icons/icon-192.png",
          tag,
          data: { url: "/" },
        });
      });
    }
    // Reschedule for next day
    scheduleLocalNotification(title, body, hour, minute, tag);
  }, delay);
}

export function useNotifications() {
  const [settings, setSettings] = useState<NotificationSettings>(getSettings);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [timers, setTimers] = useState<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const clearTimers = useCallback(() => {
    timers.forEach(clearTimeout);
    setTimers([]);
  }, [timers]);

  const scheduleNotifications = useCallback(
    (s: NotificationSettings) => {
      clearTimers();
      if (!s.enabled || Notification.permission !== "granted") return;

      const morningTimer = scheduleLocalNotification(
        "Good Morning!",
        "Time for your morning reflection. What are you grateful for?",
        s.morningHour,
        s.morningMinute,
        "morning-reminder"
      );
      const eveningTimer = scheduleLocalNotification(
        "Good Evening!",
        "Time for your evening reflection. What was the best part of your day?",
        s.eveningHour,
        s.eveningMinute,
        "evening-reminder"
      );
      setTimers([morningTimer, eveningTimer]);
    },
    [clearTimers]
  );

  const toggleNotifications = useCallback(async () => {
    if (!("Notification" in window)) {
      alert("Notifications are not supported in this browser.");
      return;
    }

    if (!settings.enabled) {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm === "granted") {
        const newSettings = { ...settings, enabled: true };
        setSettings(newSettings);
        saveSettings(newSettings);
        scheduleNotifications(newSettings);
      }
    } else {
      const newSettings = { ...settings, enabled: false };
      setSettings(newSettings);
      saveSettings(newSettings);
      clearTimers();
    }
  }, [settings, scheduleNotifications, clearTimers]);

  const updateTimes = useCallback(
    (updates: Partial<NotificationSettings>) => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);
      saveSettings(newSettings);
      if (newSettings.enabled) {
        scheduleNotifications(newSettings);
      }
    },
    [settings, scheduleNotifications]
  );

  // Reschedule on mount if enabled
  useEffect(() => {
    const s = getSettings();
    if (s.enabled && Notification.permission === "granted") {
      scheduleNotifications(s);
    }
    return () => clearTimers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    settings,
    permission,
    toggleNotifications,
    updateTimes,
  };
}
