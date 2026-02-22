import { NextRequest, NextResponse } from "next/server";

const API_KEY = process.env.OPENWEATHER_API_KEY ?? "";
const BASE = "https://api.openweathermap.org";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q");

  if (!q) {
    return NextResponse.json({ error: "q parameter required" }, { status: 400 });
  }

  if (!API_KEY) {
    return NextResponse.json(
      { error: "OPENWEATHER_API_KEY not configured" },
      { status: 500 }
    );
  }

  const url = `${BASE}/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=1&appid=${API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    return NextResponse.json({ error: `Geo API: ${res.status}` }, { status: res.status });
  }

  const data = await res.json();
  if (!data.length) {
    return NextResponse.json({ error: "Location not found" }, { status: 404 });
  }

  const { lat, lon, name, state, country } = data[0];
  return NextResponse.json({ lat, lon, name, state, country });
}
