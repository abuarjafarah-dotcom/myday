import { getServerSession } from "next-auth";
import axios from "axios";
import { authOptions } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const now = new Date();
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const response = await axios.get(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events",
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
        params: {
          timeMin: now.toISOString(),
          timeMax: nextWeek.toISOString(),
          maxResults: 10,
          singleEvents: true,
          orderBy: "startTime",
        },
      }
    );

    const events = (response.data.items || []).map((event: any) => ({
      id: event.id,
      title: event.summary,
      start: event.start?.dateTime || event.start?.date,
      end: event.end?.dateTime || event.end?.date,
    }));

    return Response.json({ events });
  } catch (error) {
    console.error("Calendar API error:", error);
    return Response.json({ error: "Failed to fetch events" }, { status: 500 });
  }
}
