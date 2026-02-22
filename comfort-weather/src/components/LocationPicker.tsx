"use client";

import { useState } from "react";

interface Props {
  onLocate: (lat: number, lon: number, name: string) => void;
}

export default function LocationPicker({ onLocate }: Props) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(query.trim())}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Not found" }));
        throw new Error(err.error ?? "Location not found");
      }
      const data = await res.json();
      const label = data.state ? `${data.name}, ${data.state}` : `${data.name}, ${data.country}`;
      onLocate(data.lat, data.lon, label);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="City, State or City, Country"
          className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-sm placeholder:text-gray-500 focus:outline-none focus:border-white/40"
        />
        <button
          onClick={search}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-sm transition-colors disabled:opacity-50"
        >
          {loading ? "..." : "Search"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
