import { timingSafeEqual } from "node:crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { viewFor } from "@/lib/users";

export const dynamic = "force-dynamic";

// Home and lock screen widgets (Scriptable on iPhone).
//
//   POST /api/widget   (signed in)  The dashboard saves a small snapshot of what only the browser knows:
//                                   today's and tomorrow's calendar, Omar's day, weather, open decisions.
//   GET  /api/widget   Authorization: Bearer <CAPTURE_TOKEN>
//                                   Combines that snapshot with the live task list and returns what's next,
//                                   what's left, Omar's line and the weather. Add &format=text for one line.
//
// Stored in dashboard_docs as owner/kind "widget"/id "snap", so it never syncs into the dashboard itself.

const TABLE = "dashboard_docs";

function tokenMatches(given: string, expected: string): boolean {
  if (expected.length < 24) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Task = { id?: string; title?: string; category?: string; date?: string | null; time?: string | null; status?: string; completedAt?: number | null; due?: string | null };
type Ev = { date: string; title: string; allDay: boolean; start: number | null; end: number | null };
type Snap = {
  v?: number; date?: string; tz?: string; units?: "C" | "F";
  events?: Ev[] | null;
  omar?: Record<string, unknown> & { line?: string };
  weather?: { temp?: number; feels?: number; condition?: string; icon?: string; days?: Record<string, { hi?: number; lo?: number; precip?: number; icon?: string } | null> } | null;
  noSchool?: string[]; decisions?: string[]; needsYou?: number; savedAt?: number;
};

// Same rules as the dashboard: "2:30 PM", "14:30", "9am".
function timeMin(t: string | null | undefined): number {
  if (!t) return 9999;
  const m = String(t).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i);
  if (!m) return 9998;
  let h = +m[1];
  const mi = +(m[2] || 0), ap = (m[3] || "").toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h * 60 + mi;
}
const clock = (min: number) => { const h = Math.floor(min / 60) % 24, m = min % 60; return `${((h + 11) % 12) + 1}${m ? ":" + String(m).padStart(2, "0") : ""} ${h >= 12 ? "PM" : "AM"}`; };
const tidy = (s: string) => String(s || "").replace(/\s+/g, " ").trim();

function localNow(tz: string, at = Date.now()): { date: string; min: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, min: (+p.hour % 24) * 60 + +p.minute };
}

async function ownerFor(request: Request): Promise<string | null> {
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (given && tokenMatches(given, process.env.CAPTURE_TOKEN || "")) return (process.env.CAPTURE_EMAIL || "").trim().toLowerCase() || null;
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  return email && viewFor(email) === "farah" ? email : null;
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (viewFor(email) !== "farah") return Response.json({ ok: true, skipped: true });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "not_configured" }, { status: 503 });
  let snap: Snap;
  try { snap = await request.json(); } catch { return Response.json({ error: "bad_json" }, { status: 400 }); }
  if (!snap || typeof snap !== "object" || JSON.stringify(snap).length > 40000) return Response.json({ error: "bad_snapshot" }, { status: 400 });
  snap.savedAt = Date.now();
  const { error } = await db.from(TABLE).upsert([{ owner: email, kind: "widget", id: "snap", data: snap, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  if (error) { console.error("widget write", error); return Response.json({ error: "write_failed" }, { status: 500 }); }
  return Response.json({ ok: true });
}

export async function GET(request: Request) {
  const owner = await ownerFor(request);
  if (!owner) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "Sync is not set up" }, { status: 503 });

  const [{ data: rows, error }, { data: snapRows }] = await Promise.all([
    db.from(TABLE).select("data").eq("owner", owner).eq("kind", "tasks"),
    db.from(TABLE).select("data").eq("owner", owner).eq("kind", "widget").eq("id", "snap").limit(1),
  ]);
  if (error) { console.error("widget read", error); return Response.json({ error: "Couldn't read your day. Try again." }, { status: 500 }); }
  const snap: Snap = (snapRows && snapRows[0] && (snapRows[0].data as Snap)) || {};
  const tz = snap.tz || "America/Chicago";
  const { date: td, min: now } = localNow(tz);
  const fresh = snap.date === td;

  const tasks = (rows || []).map((r) => r.data as Task).filter((t) => t && t.title);
  const open = (t: Task) => t.status === "todo" || t.status === "doing";
  const mine = tasks.filter((t) => open(t) && t.category !== "omar" && t.date && t.date <= td);
  const doneToday = tasks.filter((t) => t.status === "done" && t.completedAt && localNow(tz, t.completedAt).date === td).length;

  // Timed things today: tasks with a time, plus calendar events from the snapshot.
  type Item = { title: string; start: number; end: number; kind: "task" | "event" };
  const items: Item[] = [];
  mine.filter((t) => t.date === td && timeMin(t.time) < 9000).forEach((t) => { const s = timeMin(t.time); items.push({ title: tidy(t.title!), start: s, end: s + 30, kind: "task" }); });
  // The snapshot carries today and tomorrow, so last night's snapshot still knows today's calendar.
  (snap.events || [])
    .filter((e) => e.date === td && !e.allDay && e.start != null)
    .forEach((e) => items.push({ title: tidy(e.title), start: e.start!, end: Math.max(e.start!, e.end ?? e.start! + 30), kind: "event" }));
  items.sort((a, b) => a.start - b.start);
  const upcoming = items.filter((i) => i.end > now);
  const next = upcoming[0] || null;
  const fmtNext = (i: Item) => ({
    title: i.title, time: clock(i.start), kind: i.kind,
    when: i.start <= now ? "now" : i.start - now < 60 ? `in ${i.start - now} min` : clock(i.start),
  });

  const unit = snap.units === "C" ? "C" : "F";
  const deg = (f?: number) => (f == null ? null : Math.round(unit === "C" ? ((f - 32) * 5) / 9 : f));
  const wd = snap.weather?.days?.[td] || null;
  const omarToday = (snap.omar?.[td] || null) as { label?: string; emoji?: string; sleepUntil?: number | null } | null;
  const omar = fresh && snap.omar?.line ? snap.omar.line : omarToday ? `${omarToday.emoji || ""} Omar: ${omarToday.label}`.trim() : "";
  const allDay = (snap.events || []).filter((e) => e.date === td && e.allDay).map((e) => tidy(e.title));
  const noSchool = (snap.noSchool || []).includes(td);
  const decisions = fresh ? snap.decisions || [] : [];
  const left = mine.length;

  const inline = next ? `${next.start <= now ? "Now" : clock(next.start)} ${next.title}${left ? ` · ${left} left` : ""}` : left ? `${left} left today` : "All clear today";
  const body = {
    date: td,
    now: clock(now),
    next: next ? fmtNext(next) : null,
    then: upcoming.slice(1, 4).map(fmtNext),
    left,
    done: doneToday,
    omar: omar.replace(/\s+/g, " ").trim(),
    weather: snap.weather ? { temp: deg(snap.weather.temp), unit, icon: snap.weather.icon || wd?.icon || "", hi: deg(wd?.hi), lo: deg(wd?.lo), precip: wd?.precip ?? null, condition: snap.weather.condition || "" } : null,
    allDay: noSchool && !allDay.some((a) => /no school|break|closed/i.test(a)) ? ["No school", ...allDay] : allDay,
    needsYou: fresh ? snap.needsYou ?? decisions.length : 0,
    firstDecision: decisions[0] || null,
    inline,
    stale: snap.savedAt ? Math.round((Date.now() - snap.savedAt) / 3600000) : null,
    url: `${new URL(request.url).origin}/dashboard`,
  };
  if (new URL(request.url).searchParams.get("format") === "text") return new Response(inline, { headers: { "content-type": "text/plain; charset=utf-8" } });
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
