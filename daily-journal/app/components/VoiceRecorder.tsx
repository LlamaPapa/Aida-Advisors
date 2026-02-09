"use client";

import { useSpeechToText } from "@/lib/use-speech-to-text";
import { useEffect } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  placeholder?: string;
  disabled?: boolean;
};

export default function VoiceRecorder({
  value,
  onChange,
  onSave,
  placeholder = "Speak or type your positive thought...",
  disabled = false,
}: Props) {
  const {
    isListening,
    transcript,
    setTranscript,
    startListening,
    stopListening,
    resetTranscript,
  } = useSpeechToText();

  // Sync transcript to parent value while listening
  useEffect(() => {
    if (isListening && transcript) {
      onChange(transcript);
    }
  }, [transcript, isListening, onChange]);

  const handleToggle = () => {
    if (isListening) {
      stopListening();
    } else {
      resetTranscript();
      startListening();
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setTranscript(e.target.value);
        }}
        placeholder={placeholder}
        disabled={disabled}
        rows={4}
        className="w-full rounded-xl border border-gray-200 p-4 text-base resize-none
          focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent
          disabled:opacity-50 disabled:cursor-not-allowed
          placeholder:text-gray-400"
      />

      <div className="flex gap-2">
        <button
          onClick={handleToggle}
          disabled={disabled}
          className={`
            flex-1 flex items-center justify-center gap-2 py-3 px-4 rounded-xl font-medium
            transition-all active:scale-95
            ${
              isListening
                ? "bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }
            disabled:opacity-50 disabled:cursor-not-allowed
          `}
        >
          {isListening ? (
            <>
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
              Stop Recording
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                />
              </svg>
              Record
            </>
          )}
        </button>

        <button
          onClick={onSave}
          disabled={disabled || !value.trim()}
          className="flex-1 py-3 px-4 rounded-xl font-medium bg-indigo-600 text-white
            hover:bg-indigo-700 active:scale-95 transition-all
            disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-indigo-200"
        >
          Save Entry
        </button>
      </div>
    </div>
  );
}
