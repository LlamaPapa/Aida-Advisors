"use client";

import { HourlyWeather, Units } from "@/lib/types";
import { tempDisplayShort } from "@/lib/units";

function precipIcon(pop: number, rain?: { "1h": number }, snow?: { "1h": number }): string {
  if (snow && snow["1h"] > 0 && pop >= 0.2) return "\u2744";
  if (rain && rain["1h"] > 0 && pop >= 0.2) return "\uD83C\uDF27";
  if (pop >= 0.4) return "\uD83D\uDCA7";
  return "";
}

function weatherEmoji(id: number): string {
  if (id >= 200 && id < 300) return "\u26C8";
  if (id >= 300 && id < 400) return "\uD83C\uDF26";
  if (id >= 500 && id < 600) return "\uD83C\uDF27";
  if (id >= 600 && id < 700) return "\u2744";
  if (id >= 700 && id < 800) return "\uD83C\uDF2B";
  if (id === 800) return "\u2600";
  if (id >= 801 && id <= 802) return "\u26C5";
  return "\u2601";
}

interface Props {
  hourly: HourlyWeather[];
  units: Units;
}

export default function HourlyStrip({ hourly, units }: Props) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-2">
      {hourly.map((h) => {
        const time = new Date(h.dt * 1000);
        const hour = time.getHours();
        const label = hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`;
        const precip = precipIcon(h.pop, h.rain, h.snow);
        const emoji = weatherEmoji(h.weather[0]?.id ?? 800);

        return (
          <div
            key={h.dt}
            className="flex flex-col items-center min-w-[3.2rem] px-1 py-2 rounded-lg bg-white/10"
          >
            <span className="text-xs text-gray-400">{label}</span>
            <span className="text-sm my-1">{emoji}</span>
            <span className="text-sm font-medium">{tempDisplayShort(h.temp, units)}</span>
            {precip && (
              <span className="text-xs mt-0.5">{precip} {Math.round(h.pop * 100)}%</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
