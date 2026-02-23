# Comfort Weather

A mobile-first PWA that tells you exactly what to wear based on current weather conditions and your personal comfort preferences. Focused on thermal comfort, not fashion.

## Features

- **Clothing recommendation engine** — deterministic rule-based system (no LLM) that outputs a single clothing stack: base layer, mid layer, outer layer, and extras
- **"Effective temp for you"** — personalized temperature shown on every recommendation
- **Weather data** — current conditions + 8-hour hourly forecast via OpenWeather One Call 3.0
- **Personal calibration** — adjusts for activity level, time outside, whether you run hot/cold, and sweat sensitivity
- **Feedback loop** — "Too cold / Good / Too hot" buttons shift a comfort offset (±2°F per tap, clamped to ±10°F)
- **Reset learning** — clear offset and feedback history from settings
- **PWA** — installable on mobile, works offline for cached pages
- **No accounts** — all preferences stored in localStorage with versioned keys (`cw_prefs_v1`, `cw_feedback_v1`)

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

### Run Tests

```bash
npm test
```

10-case test matrix validates wind scaling, rain logic, activity adjustment, offset learning, and sweat bias.

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
│   │   ├── settings/page.tsx       # Settings page (units, defaults, reset learning)
│   │   ├── layout.tsx              # Root layout with PWA metadata
│   │   ├── globals.css
│   │   └── page.tsx                # Home page
│   ├── components/
│   │   ├── FeedbackButtons.tsx     # Too cold / Good / Too hot
│   │   ├── HourlyStrip.tsx         # 8-hour horizontal forecast
│   │   ├── LocationPicker.tsx      # Manual city search fallback
│   │   ├── PrefsForm.tsx           # Time/activity/run/sweaty controls
│   │   ├── RecommendationCard.tsx  # 4-row clothing stack + effective temp
│   │   └── ServiceWorkerRegistrar.tsx
│   └── lib/
│       ├── types.ts                # All TypeScript types (Conditions, Prefs, Recommendation)
│       ├── rules.ts                # Deterministic recommendation engine
│       ├── rules.test.ts           # 10-case test matrix
│       ├── storage.ts              # Versioned localStorage (cw_prefs_v1, cw_feedback_v1)
│       ├── units.ts                # F/C conversion helpers
│       └── openweather.ts          # Client-side API calls
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
effectiveTempF = tempF + comfortOffsetF + runHotColdAdjust
               - windPenaltyF - wetPenaltyF + activityAdjustF
```

- **windPenaltyF**: `clamp((windMph / 3) * (timeOutsideMin / 30), 0, 10)`
- **wetPenaltyF**: pop >= 0.6 → 6°F, pop >= 0.35 → 3°F
- **activityAdjustF**: still=0, walking=+2, workout=+8
- **runHotColdAdjustF**: cold=-4 (feel cold → dress warmer), neutral=0, hot=+4 (overheat → dress lighter)
- **comfortOffsetF**: learned from feedback (±2°F per tap, clamped ±10°F)

Layer bands: >=70°F (t-shirt) → 60s → 50s → 40s → 30s → 20s → <20°F (full winter gear).

"Hate being sweaty" nudges lighter near thresholds and prefers shells over heavy insulation.
