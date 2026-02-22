import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.OPENWEATHER_API_KEY ?? "";
const BASE = "https://api.openweathermap.org";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const lat = searchParams.get("lat");
  const lon = searchParams.get("lon");

  if (!lat || !lon) {
    return NextResponse.json({ error: "lat and lon required" }, { status: 400 });
  }

  if (!API_KEY) {
    return NextResponse.json(
      { error: "OPENWEATHER_API_KEY not configured" },
      { status: 500 }
    );
  }

  const url = `${BASE}/data/3.0/onecall?lat=${lat}&lon=${lon}&units=imperial&exclude=minutely,daily,alerts&appid=${API_KEY}`;

  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Weather API: ${res.status}`, detail: text },
      { status: res.status }
    );
  }

  const data = await res.json();
  return NextResponse.json(data);
}
