import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { fetchIcloudEvents } from "@/lib/ical";
import { icloudUrlsFor } from "@/lib/users";
import { viewFor } from "@/lib/users";
import { publishOmarCalendar } from "@/lib/partner";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type GCal = { id: string; summary?: string; backgroundColor?: string; selected?: boolean; hidden?: boolean };

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || session.error) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const headers = { Authorization: `Bearer ${session.accessToken}` };
  try {
    // Every calendar that is checked in Google Calendar (yours, shared, and subscribed ones like iCloud).
    const listRes = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250",
      { headers, cache: "no-store" }
    );
    if (listRes.status === 401) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const list = await listRes.json();
    const calendars: GCal[] = (list.items || []).filter((c: GCal) => c.selected && !c.hidden);
    if (!calendars.length) calendars.push({ id: "primary", summary: "Calendar" });

    // From a day and a half ago (covers "today" in any US time zone) through 15 days out, so next week is always complete.
    const now = Date.now();
    const from = now - 36 * 3600 * 1000, to = now + 15 * 24 * 3600 * 1000;
    // iCloud feeds (ICLOUD_CALENDAR_URLS in Vercel) load alongside Google; a failed feed is skipped, never fatal.
    let icloudFailed = false;
    const failed: { name: string; status: number }[] = [];
    const icloudPromise = fetchIcloudEvents(from, to, icloudUrlsFor(session.user?.email)).catch(() => { icloudFailed = true; return []; });
    const params = new URLSearchParams({
      timeMin: new Date(from).toISOString(),
      timeMax: new Date(to).toISOString(),
      maxResults: "250",
      singleEvents: "true",
      orderBy: "startTime",
    });

    const perCalendar = await Promise.all(
      calendars.map(async (cal) => {
        try {
          const r = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
            { headers, cache: "no-store" }
          );
          if (!r.ok) { failed.push({ name: cal.summary || cal.id, status: r.status }); return []; }
          const data = await r.json();
          const color = /^#[0-9a-fA-F]{3,8}$/.test(cal.backgroundColor || "") ? cal.backgroundColor : null;
          return (data.items || [])
            .filter((e: any) => e.status !== "cancelled")
            .map((e: any) => ({
              id: `${cal.id}:${e.id}`,
              title: e.summary || "(No title)",
              start: e.start?.dateTime || e.start?.date,
              end: e.end?.dateTime || e.end?.date,
              allDay: !e.start?.dateTime,
              calendar: cal.summary || "",
              color,
              ...(e.location ? { location: String(e.location).slice(0, 200) } : {}),
              source: "google" as const,
            }));
        } catch {
          failed.push({ name: cal.summary || cal.id, status: 0 });
          return [];
        }
      })
    );

    // Same event on two calendars (e.g. an invite) shows once.
    // Google first, so a calendar subscribed in both places keeps its Google copy.
    const icloud = await icloudPromise;
    const seen = new Set<string>();
    const events = [...perCalendar.flat(), ...icloud]
      .filter((e) => {
        const when = e.allDay ? String(e.start).slice(0, 10) : String(new Date(e.start).getTime());
        const key = `${String(e.title).trim().toLowerCase()}|${when}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    // `info` tells the dashboard exactly what came back, so a missing day is easy to diagnose.
    const info = {
      from: new Date(from).toISOString(), to: new Date(to).toISOString(),
      calendars: calendars.map((c) => c.summary || c.id),
      google: events.filter((e) => e.source === "google").length, icloud: events.filter((e) => e.source === "icloud").length,
      failed, icloudFailed,
    };
    // Omar's page keeps Farah's "Omar this week" strip current (generic labels only, and only if he shares).
    if (viewFor(session.user?.email) === "omar") {
      const db = supabaseAdmin();
      if (db) await publishOmarCalendar(db, events).catch((e) => console.error("share publish", e instanceof Error ? e.message : e));
    }
    return Response.json({ events, info });
  } catch (error) {
    console.error("Calendar API error:", error);
    return Response.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
