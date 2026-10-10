import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { omarEmail } from "@/lib/users";

export const dynamic = "force-dynamic";

// Time blocks for tasks on the signed-in person's primary Google Calendar.
//   POST   { taskId, title, date: "YYYY-MM-DD", start: minutes, mins, tz, inviteOmar?, emails?, eventId? }
//          creates the block, or moves it when eventId is given. Returns { id, link }.
//   DELETE ?id=<eventId>  removes a block (task dropped or unscheduled).
// A 403 with { error: "scope" } means the sign-in predates calendar write access: sign in again.

const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const pad = (n: number) => String(n).padStart(2, "0");
const localStamp = (date: string, min: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCMinutes(min);
  return `${d.toISOString().slice(0, 10)}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`;
};
const validEmail = (s: unknown) => typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

async function auth() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || session.error) return null;
  return { headers: { Authorization: `Bearer ${session.accessToken}`, "Content-Type": "application/json" }, email: session.user?.email || "" };
}

async function googleError(r: Response) {
  const body = await r.json().catch(() => ({}));
  const reason = JSON.stringify(body);
  if (r.status === 403 && /insufficient|scope|PERMISSION/i.test(reason)) return Response.json({ error: "scope" }, { status: 403 });
  if (r.status === 401) return Response.json({ error: "Unauthorized" }, { status: 401 });
  console.error("calendar block", r.status, reason.slice(0, 300));
  return Response.json({ error: "google", status: r.status }, { status: 502 });
}

export async function POST(request: Request) {
  const a = await auth();
  if (!a) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json().catch(() => null);
  if (!b || typeof b.title !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.date || "") || typeof b.start !== "number") {
    return Response.json({ error: "bad request" }, { status: 400 });
  }
  const mins = Math.max(5, Math.min(600, Math.round(Number(b.mins) || 30)));
  const tz = typeof b.tz === "string" && b.tz.length < 64 ? b.tz : "America/Chicago";
  const guests = new Set<string>();
  if (b.inviteOmar && omarEmail() && omarEmail() !== a.email.toLowerCase()) guests.add(omarEmail());
  (Array.isArray(b.emails) ? b.emails : []).filter(validEmail).slice(0, 10).forEach((e: string) => guests.add(e.trim().toLowerCase()));

  const event: Record<string, unknown> = {
    summary: String(b.title).slice(0, 200),
    description: "Planned in myday · https://myday-orcin.vercel.app/dashboard",
    start: { dateTime: localStamp(b.date, b.start), timeZone: tz },
    end: { dateTime: localStamp(b.date, b.start + mins), timeZone: tz },
    colorId: "9",
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] },
    extendedProperties: { private: { mydayTask: String(b.taskId || "").slice(0, 80) } },
  };
  if (guests.size) event.attendees = [...guests].map((email) => ({ email }));

  const id = typeof b.eventId === "string" && /^[a-zA-Z0-9_-]{4,1024}$/.test(b.eventId) ? b.eventId : null;
  const sendUpdates = guests.size ? "all" : "none";
  const url = id ? `${API}/${encodeURIComponent(id)}?sendUpdates=${sendUpdates}` : `${API}?sendUpdates=${sendUpdates}`;
  let r = await fetch(url, { method: id ? "PATCH" : "POST", headers: a.headers, body: JSON.stringify(event) });
  // A block deleted in Google Calendar gets recreated instead of failing.
  if (id && (r.status === 404 || r.status === 410)) {
    r = await fetch(`${API}?sendUpdates=${sendUpdates}`, { method: "POST", headers: a.headers, body: JSON.stringify(event) });
  }
  if (!r.ok) return googleError(r);
  const ev = await r.json();
  return Response.json({ id: ev.id, link: ev.htmlLink || null, invited: guests.size });
}

export async function DELETE(request: Request) {
  const a = await auth();
  if (!a) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!/^[a-zA-Z0-9_-]{4,1024}$/.test(id)) return Response.json({ error: "bad request" }, { status: 400 });
  const r = await fetch(`${API}/${encodeURIComponent(id)}?sendUpdates=all`, { method: "DELETE", headers: a.headers });
  if (!r.ok && r.status !== 404 && r.status !== 410) return googleError(r);
  return Response.json({ ok: true });
}
