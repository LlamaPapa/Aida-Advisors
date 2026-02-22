# Comfort Weather

A mobile-first PWA that tells you exactly what to wear based on current weather conditions and your personal comfort preferences. Focused on thermal comfort, not fashion.

## Features

- **Clothing recommendation engine** — deterministic rule-based system (no LLM) that outputs a single clothing stack: base layer, mid layer, outer layer, and extras
- **Weather data** — current conditions + 8-hour hourly forecast via OpenWeather One Call 3.0
- **Personal calibration** — adjusts for activity level, time outside, whether you run hot/cold, and sweat sensitivity
- **Feedback loop** — "Too cold / Good / Too hot" buttons shift a comfort offset (±2°F per tap, clamped to ±10°F), stored locally
- **PWA** — installable on mobile, works offline for cached pages
- **No accounts** — all preferences stored in localStorage

## Setup

### Prerequisites

- Node.js 18+
- An [OpenWeather](https://openweathermap.org/) API key with **One Call 3.0** access

### Install & Run

```bash
cd comfort-weather
npm install

# Create .env.local with your API key
cp .env.local.example .env.local
# Edit .env.local and add your OPENWEATHER_API_KEY

npm run dev
```

Open [http://localhost:3000](http://localhost:3000) on your phone or browser.

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `OPENWEATHER_API_KEY` | Yes | OpenWeather API key (needs One Call 3.0 subscription) |

### Build for Production

```bash
npm run build
npm start
```

### Deploy

Deploy to any platform that supports Next.js (Vercel, Railway, Fly.io, etc.). Set the `OPENWEATHER_API_KEY` environment variable in your hosting provider's dashboard.

## Project Structure

```
comfort-weather/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── weather/route.ts    # Proxies OpenWeather API (keeps key server-side)
│   │   │   └── geocode/route.ts    # City name → lat/lon lookup
│   │   ├── settings/page.tsx       # Settings page (units, defaults)
│   │   ├── layout.tsx              # Root layout with PWA metadata
│   │   ├── globals.css
│   │   └── page.tsx                # Home page
│   ├── components/
│   │   ├── FeedbackButtons.tsx     # Too cold / Good / Too hot
│   │   ├── LocationSearch.tsx      # Manual city search fallback
│   │   ├── RecommendationCard.tsx  # 4-row clothing stack display
│   │   ├── ServiceWorkerRegistrar.tsx
│   │   └── WeatherStrip.tsx        # 8-hour horizontal forecast
│   └── lib/
│       ├── types.ts                # All TypeScript types
│       ├── rules.ts                # Deterministic recommendation engine
│       ├── storage.ts              # localStorage helpers
│       ├── api.ts                  # Server-side weather fetch (unused in favor of API routes)
│       └── weather-client.ts       # Client-side API calls
├── public/
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Service worker
│   ├── icon-192.png
│   └── icon-512.png
└── .env.local.example
```

## How the Rule Engine Works

The engine in `src/lib/rules.ts` computes an **effective temperature**:

```
effectiveTemp = temp - windPenalty + sunBonus - wetPenalty + comfortOffset + runsAdj + activityAdj
```

- **windPenalty**: scales with wind speed and time outside
- **wetPenalty**: applies when precipitation probability ≥ 35% with intensity, or ≥ 60%
- **sunBonus**: +3°F during daytime with low wind and no precip
- **runsAdj**: cold +4°F, hot -4°F
- **activityAdj**: workout +8°F, walking +3°F
- **comfortOffset**: learned from user feedback (±2°F per tap)

The effective temperature maps to layer thresholds (70°F+ = t-shirt only, down to <20°F = full winter gear). The "hate being sweaty" toggle shifts picks lighter and prefers breathable shells over heavy insulation.
