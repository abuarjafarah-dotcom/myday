import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchIcloudEvents } from "@/lib/ical";
import { omarEmail } from "@/lib/users";
import { dayStatuses, sanitize, type DayStatus, type Ev, type Trip } from "@/lib/dayStatus";

// Omar's day at a glance for Farah: shift / travel / admin / off / meetings count. Never event titles or times.
// Omar turns this on from his page ("Share my day with Farah"). Sources: his Google Calendar (saved as generic
// labels whenever his page loads), his iPhone calendars (ICLOUD_CALENDAR_URLS_OMAR, read live) and his trips.

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
const TABLE = "dashboard_docs";

export function isFarah(email: string | null | undefined): boolean {
  const f = (process.env.CAPTURE_EMAIL || "").trim().toLowerCase();
  return !!f && String(email || "").trim().toLowerCase() === f;
}

async function doc(db: Db, owner: string, kind: string, id: string): Promise<Record<string, unknown> | null> {
  const { data } = await db.from(TABLE).select("data").eq("owner", owner).eq("kind", kind).eq("id", id).maybeSingle();
  return (data?.data as Record<string, unknown>) || null;
}

export async function omarShares(db: Db): Promise<boolean> {
  const owner = omarEmail();
  if (!owner) return false;
  const meta = await doc(db, owner, "meta", "main");
  return !!(meta && meta.shareWithFarah === true);
}

// Called from Omar's calendar load. Stores generic labels only, and only when he has sharing on.
export async function publishOmarCalendar(db: Db, events: Ev[]): Promise<void> {
  const owner = omarEmail();
  if (!owner || !(await omarShares(db))) return;
  const google = events.filter((e) => !String((e as { id?: string }).id || "").startsWith("icloud:")).map(sanitize);
  await db.from(TABLE).upsert(
    [{ owner, kind: "share", id: "calendar", data: { id: "calendar", events: google, updatedAt: Date.now() }, updated_at: new Date().toISOString() }],
    { onConflict: "owner,kind,id" }
  );
}

export async function partnerDays(db: Db, days = 7): Promise<{ shared: boolean; days: DayStatus[]; updatedAt: number | null }> {
  const owner = omarEmail();
  if (!owner || !(await omarShares(db))) return { shared: false, days: [], updatedAt: null };
  const now = Date.now();
  const [pub, icloud, tripRows] = await Promise.all([
    doc(db, owner, "share", "calendar"),
    fetchIcloudEvents(now - 2 * 86400000, now + (days + 1) * 86400000, process.env.ICLOUD_CALENDAR_URLS_OMAR || "").catch(() => []),
    db.from(TABLE).select("data").eq("owner", owner).eq("kind", "trips"),
  ]);
  const seen = new Set<string>();
  const events = [...((pub?.events as Ev[]) || []), ...icloud.map(sanitize)].filter((e) => {
    const k = `${e.title}|${e.start}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const trips = ((tripRows.data || []) as { data: Trip }[]).map((r) => r.data);
  return { shared: true, days: dayStatuses(events, trips, days), updatedAt: (pub?.updatedAt as number) || null };
}
