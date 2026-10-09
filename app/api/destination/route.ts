import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Trip card data. Free sources, no keys:
//   Open-Meteo geocoding + forecast (°C)   https://open-meteo.com
//   Wikipedia summary (highlights)          https://en.wikipedia.org
//   Wikivoyage (see / do / eat picks)       https://en.wikivoyage.org
// GET /api/destination?place=Lisbon&start=2026-10-20&end=2026-10-24

const UA = { "User-Agent": "myday-dashboard/1.0 (https://myday-orcin.vercel.app)", Accept: "application/json" };
const HOUR = 3600;

const CODES: Record<number, [string, string]> = {
  0: ["Clear", "☀️"], 1: ["Mostly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Fog", "🌫️"], 51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"], 61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"], 71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "🌨️"], 80: ["Light showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Heavy showers", "🌧️"],
  85: ["Snow showers", "🌨️"], 86: ["Snow showers", "🌨️"], 95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"],
};

type Geo = { name: string; country?: string; admin1?: string; latitude: number; longitude: number; timezone?: string; feature_code?: string; population?: number };

async function getJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const r = await fetch(url, { headers: UA, next: { revalidate } } as RequestInit);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

// "Sydney Australia" -> tries "Sydney Australia", then "Sydney", then "Australia".
async function geocode(place: string): Promise<Geo | null> {
  const words = place.replace(/[,]+/g, " ").split(/\s+/).filter(Boolean);
  const tries = Array.from(new Set([words.join(" "), ...words.map((_, i) => words.slice(0, words.length - i).join(" ")), words[words.length - 1]])).filter(Boolean);
  for (const name of tries) {
    const data = await getJson<{ results?: Geo[] }>(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`,
      24 * HOUR
    );
    const list = data?.results || [];
    if (!list.length) continue;
    // Prefer a match in the country that was also said ("Sydney Australia"), then the biggest place.
    const rest = words.join(" ").toLowerCase();
    const inCountry = list.filter((g) => g.country && rest.includes(g.country.toLowerCase()) && g.name.toLowerCase() !== g.country.toLowerCase());
    const pick = (inCountry.length ? inCountry : list).slice().sort((a, b) => (b.population || 0) - (a.population || 0))[0];
    return pick;
  }
  return null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

async function forecast(g: Geo, start: string | null, end: string | null) {
  const today = ymd(new Date());
  const horizon = addDays(today, 15);
  const from = start && start > today ? start : today;
  let to = end && end >= from ? end : addDays(from, 4);
  if (to > horizon) to = horizon;
  if (from > horizon) {
    return { days: [], note: `The forecast opens about two weeks out, around ${addDays(start as string, -15)}.` };
  }
  const data = await getJson<{ daily?: Record<string, (number | string)[]> }>(
    `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
      `&temperature_unit=celsius&timezone=auto&start_date=${from}&end_date=${to}`,
    HOUR
  );
  const d = data?.daily;
  if (!d || !Array.isArray(d.time)) return { days: [], note: "Forecast unavailable right now." };
  const days = (d.time as string[]).map((date, i) => {
    const code = Number(d.weather_code?.[i]);
    const [label, icon] = CODES[code] || ["—", "🌡️"];
    return {
      date,
      hi: Math.round(Number(d.temperature_2m_max?.[i])),
      lo: Math.round(Number(d.temperature_2m_min?.[i])),
      rain: d.precipitation_probability_max?.[i] ?? null,
      label,
      icon,
    };
  });
  const partial = end && end > to ? "Later days appear once they are within the forecast range." : "";
  return { days, note: partial };
}

async function wikipedia(title: string) {
  const s = await getJson<{ extract?: string; content_urls?: { mobile?: { page?: string } }; thumbnail?: { source?: string }; type?: string }>(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    24 * HOUR
  );
  if (!s || s.type === "disambiguation" || !s.extract) return null;
  const sentences = s.extract.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ");
  return { summary: sentences, url: s.content_urls?.mobile?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`, image: s.thumbnail?.source || null };
}

function stripWiki(s: string): string {
  return s
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/'{2,}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type Pick = { name: string; about: string };

function listings(section: string, kinds: string[], max: number): Pick[] {
  const out: Pick[] = [];
  const re = new RegExp(`\\{\\{\\s*(?:${kinds.join("|")}|listing)\\s*\\|([\\s\\S]*?)\\}\\}`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(section)) && out.length < max) {
    const field = (k: string) => (m![1].match(new RegExp(`\\|?\\s*${k}\\s*=\\s*([^|]*)`, "i"))?.[1] || "").trim();
    const name = stripWiki(field("name"));
    if (!name) continue;
    const about = stripWiki(field("content") || field("description")).split(/(?<=[.!?])\s+/)[0] || "";
    out.push({ name, about: about.slice(0, 160) });
  }
  if (out.length < max) {
    // Older pages list places as "* '''Name''' — description".
    for (const line of section.split("\n")) {
      if (out.length >= max) break;
      const b = line.match(/^\*\s*'''([^']+)'''\s*[,:—–-]?\s*(.*)$/);
      if (b && !out.some((o) => o.name === stripWiki(b[1]))) out.push({ name: stripWiki(b[1]), about: stripWiki(b[2]).split(/(?<=[.!?])\s+/)[0].slice(0, 160) });
    }
  }
  return out;
}

function placesList(section: string, max: number): Pick[] {
  const out: Pick[] = [];
  // Big cities and countries use {{Regionlist | region1name=[[Lisbon/Baixa|Baixa]] | region1description=...}}.
  const region = /region(\d+)name\s*=\s*([^\n|]+(?:\|[^\n\]]*\]\])?)/gi;
  let r: RegExpExecArray | null;
  while ((r = region.exec(section)) && out.length < max) {
    const name = stripWiki(r[2]);
    const desc = section.match(new RegExp(`region${r[1]}description\\s*=\\s*([^\\n|]+)`, "i"))?.[1] || "";
    if (name) out.push({ name, about: stripWiki(desc).split(/(?<=[.!?])\s+/)[0].slice(0, 160) });
  }
  for (const line of section.split("\n")) {
    if (out.length >= max) break;
    const m = line.match(/^\*\s*(?:\{\{marker[^}]*name=\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\][^}]*\}\}|\[\[([^\]|]+)(?:\|[^\]]*)?\]\])\s*[,:—–-]?\s*(.*)$/i);
    if (m) out.push({ name: (m[1] || m[2]).trim(), about: stripWiki(m[3] || "").split(/(?<=[.!?])\s+/)[0].slice(0, 160) });
  }
  return out;
}

async function wikivoyage(title: string) {
  const data = await getJson<{ parse?: { title?: string; wikitext?: { "*"?: string } } }>(
    `https://en.wikivoyage.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json`,
    24 * HOUR
  );
  const text = data?.parse?.wikitext?.["*"];
  if (!text) return null;
  const sections: Record<string, string> = {};
  const parts = text.split(/^==\s*([^=\n][^\n]*?)\s*==\s*$/m);
  for (let i = 1; i < parts.length; i += 2) sections[parts[i].trim().toLowerCase()] = parts[i + 1] || "";
  const see = listings(sections["see"] || "", ["see"], 4);
  const doo = listings(sections["do"] || "", ["do"], 3);
  const eat = listings(sections["eat"] || "", ["eat", "drink"], 3);
  const areas = placesList(sections["cities"] || sections["districts"] || sections["regions"] || "", 5);
  const nearby = placesList(sections["other destinations"] || sections["go next"] || "", 4);
  return {
    url: `https://en.wikivoyage.org/wiki/${encodeURIComponent((data?.parse?.title || title).replace(/ /g, "_"))}`,
    see, do: doo, eat, areas, nearby,
  };
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const place = (url.searchParams.get("place") || "").trim().slice(0, 80);
  const valid = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);
  const start = valid(url.searchParams.get("start"));
  const end = valid(url.searchParams.get("end"));
  if (!place) return Response.json({ error: "No place given" }, { status: 400 });

  const geo = await geocode(place);
  if (!geo) return Response.json({ error: `Couldn't find "${place}"` }, { status: 404 });
  const isCountry = (geo.feature_code || "").startsWith("PCL");
  const title = geo.name;
  const [weather, wiki, voyage] = await Promise.all([forecast(geo, start, end), wikipedia(title), wikivoyage(title)]);
  return Response.json(
    {
      place: { name: geo.name, region: geo.admin1 || null, country: geo.country || null, isCountry, timezone: geo.timezone || null },
      weather,
      highlights: wiki,
      picks: voyage,
    },
    { headers: { "Cache-Control": "private, max-age=900" } }
  );
}
