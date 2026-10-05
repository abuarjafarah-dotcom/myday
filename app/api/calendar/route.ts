import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || session.error) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    // Start of today in Rochester, MN, through 8 days out.
    const now = new Date();
    const start = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    const end = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      maxResults: "100",
      singleEvents: "true",
      orderBy: "startTime",
    });
    const r = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${session.accessToken}` }, cache: "no-store" }
    );
    if (r.status === 401) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const data = await r.json();
    const events = (data.items || [])
      .filter((e: any) => e.status !== "cancelled")
      .map((e: any) => ({
        id: e.id,
        title: e.summary || "(No title)",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        allDay: !e.start?.dateTime,
      }));
    return Response.json({ events });
  } catch (error) {
    console.error("Calendar API error:", error);
    return Response.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
