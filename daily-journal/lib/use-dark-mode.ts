"use client";

import { useState, useEffect, useCallback } from "react";

const STORAGE_KEY = "journal-dark-mode";

export function useDarkMode() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "true") {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    } else if (saved === "auto" || saved === null) {
      // Auto: dark after 7pm, before 7am
      const hour = new Date().getHours();
      const shouldBeDark = hour >= 19 || hour < 7;
      setIsDark(shouldBeDark);
      if (shouldBeDark) document.documentElement.classList.add("dark");
    }
  }, []);

  const toggle = useCallback(() => {
    setIsDark((prev) => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  }, []);

  return { isDark, toggle };
}
