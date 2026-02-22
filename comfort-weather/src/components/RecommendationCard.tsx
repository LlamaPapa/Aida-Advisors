"use client";

import { Recommendation } from "@/lib/types";

interface Props {
  rec: Recommendation;
}

export default function RecommendationCard({ rec }: Props) {
  const rows = [
    { label: "Base layer", value: rec.base },
    { label: "Mid layer", value: rec.mid },
    { label: "Outer layer", value: rec.outer },
    { label: "Extras", value: rec.extras },
  ];

  return (
    <div className="rounded-xl bg-white/10 backdrop-blur p-4 space-y-2">
      <h2 className="text-lg font-semibold mb-3">What to Wear</h2>
      {rows.map((r) => (
        <div key={r.label} className="flex justify-between items-baseline py-1 border-b border-white/10 last:border-0">
          <span className="text-sm text-gray-400">{r.label}</span>
          <span className="text-sm font-medium text-right">{r.value}</span>
        </div>
      ))}
      <p className="text-xs text-gray-400 pt-2 italic">{rec.why}</p>
    </div>
  );
}
