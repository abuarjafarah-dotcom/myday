import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { omarEmail } from "@/lib/users";
import { partnerDays } from "@/lib/partner";
import { listShared, type Who } from "@/lib/household";

// "This week at home": one shared picture of the week for Farah and Omar, framed around balance and next week's plan.
// Counts only, never task titles. Farah decides whether Omar sees it (meta.main.loadShare, on by default).

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
const TABLE = "dashboard_docs";
const TZ = process.env.CALENDAR_TIMEZONE || "America/Chicago";

const ymdIn = (ts: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
const mondayOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); return addDays(ymd, -((dow + 6) % 7)); };

export type WeekShare = {
  mon: string;
  shared: boolean;                       // Omar can see it
  farah: { done: number };
  omar: { done: number; household: number; shifts: number };
  next: { mon: string; nights: number; shifts: number; planned: boolean };
};

type Doc = Record<string, unknown>;
async function rows(db: Db, owner: string, kind: string): Promise<Doc[]> {
  if (!owner) return [];
  const { data } = await db.from(TABLE).select("data").eq("owner", owner).eq("kind", kind);
  return ((data || []) as { data: Doc }[]).map((r) => r.data).filter(Boolean);
}

export async function weekShare(db: Db, viewer: Who): Promise<WeekShare | null> {
  const farah = (process.env.CAPTURE_EMAIL || "").trim().toLowerCase();
  const omar = omarEmail();
  const td = ymdIn(Date.now()), mon = mondayOf(td), sun = addDays(mon, 6), nextMon = addDays(mon, 7), nextSun = addDays(mon, 13);
  const [fTasks, fMeta, oTasks, shared, partner] = await Promise.all([
    rows(db, farah, "tasks"), rows(db, farah, "meta"), rows(db, omar, "tasks"), listShared(db).catch(() => []), partnerDays(db, 14).catch(() => ({ days: [] as { date: string; kind: string }[] })),
  ]);
  const meta = (fMeta.find((m) => m.id === "main") || {}) as Doc;
  const share = meta.loadShare !== false;
  if (viewer === "omar" && !share) return null;
  const inWeek = (ts: unknown) => typeof ts === "number" && ts > 0 && ymdIn(ts) >= mon && ymdIn(ts) <= td;

  const farahDone = fTasks.filter((t) => t.status === "done" && t.category !== "omar" && inWeek(t.completedAt)).length;
  const omarOwn = oTasks.filter((t) => (t.status === "done" || t.done === true) && t.source !== "calendar" && inWeek(t.doneAt ?? t.completedAt)).length;
  const omarHousehold = shared.filter((t) => t.status === "done" && t.doneBy === "omar" && inWeek(t.doneAt)).length;

  // Shifts: what Farah set by hand in Week View wins; otherwise Omar's shared calendar.
  const manual = (meta.shifts || {}) as Record<string, string>;
  const work = new Set(["night", "day", "oncall"]);
  const kindOn = (d: string) => manual[d] ? (manual[d] === "off" ? "off" : manual[d]) : (partner.days.find((x) => x.date === d) || { kind: "" }).kind;
  const count = (from: string, to: string, pick: (k: string) => boolean) => { let n = 0; for (let d = from; d <= to; d = addDays(d, 1)) if (pick(kindOn(d))) n++; return n; };
  const sync = (meta.sync || {}) as Record<string, { doneAt?: number | null }>;

  return {
    mon,
    shared: share,
    farah: { done: farahDone },
    omar: { done: omarOwn, household: omarHousehold, shifts: count(mon, sun, (k) => work.has(k)) },
    next: { mon: nextMon, nights: count(nextMon, nextSun, (k) => k === "night"), shifts: count(nextMon, nextSun, (k) => work.has(k)), planned: !!(sync[nextMon] && sync[nextMon].doneAt) },
  };
}
