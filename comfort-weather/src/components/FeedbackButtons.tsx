"use client";

import { useState } from "react";

interface Props {
  onFeedback: (fb: "too_cold" | "good" | "too_hot") => void;
}

export default function FeedbackButtons({ onFeedback }: Props) {
  const [submitted, setSubmitted] = useState<string | null>(null);

  const handle = (fb: "too_cold" | "good" | "too_hot") => {
    onFeedback(fb);
    setSubmitted(fb);
    setTimeout(() => setSubmitted(null), 2000);
  };

  if (submitted) {
    return (
      <div className="text-center text-sm text-gray-400 py-2">
        Thanks! Your feedback helps calibrate recommendations.
      </div>
    );
  }

  return (
    <div className="flex gap-2 justify-center">
      <button
        onClick={() => handle("too_cold")}
        className="px-4 py-2 rounded-lg bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 text-sm transition-colors"
      >
        Too cold
      </button>
      <button
        onClick={() => handle("good")}
        className="px-4 py-2 rounded-lg bg-green-500/20 hover:bg-green-500/30 text-green-300 text-sm transition-colors"
      >
        Good
      </button>
      <button
        onClick={() => handle("too_hot")}
        className="px-4 py-2 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 text-sm transition-colors"
      >
        Too hot
      </button>
    </div>
  );
}
