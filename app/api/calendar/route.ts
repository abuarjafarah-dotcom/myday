import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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

    // From a day and a half ago (covers "today" in any US time zone) through 8 days out.
    const now = Date.now();
    const params = new URLSearchParams({
      timeMin: new Date(now - 36 * 3600 * 1000).toISOString(),
      timeMax: new Date(now + 8 * 24 * 3600 * 1000).toISOString(),
      maxResults: "100",
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
          if (!r.ok) return [];
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
            }));
        } catch {
          return [];
        }
      })
    );

    // Same event on two calendars (e.g. an invite) shows once.
    const seen = new Set<string>();
    const events = perCalendar
      .flat()
      .filter((e) => {
        const key = `${e.title}|${e.start}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));

    return Response.json({ events });
  } catch (error) {
    console.error("Calendar API error:", error);
    return Response.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
