import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { omarEmail } from "@/lib/users";
import { partnerDays } from "@/lib/partner";
import { listShared } from "@/lib/household";

// "This week at home": a picture of the week framed around balance and next week's plan. Counts only, never task titles.
// Private to Farah. She can send Omar a snapshot ("Send to Omar"); he sees only what she sent, never a live view.

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
  sentAt: number | null;                 // when Farah last sent this week's snapshot to Omar
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

const HOUSEHOLD = "_household";
async function lastSent(db: Db): Promise<WeekShare | null> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", "weekcard").eq("id", "latest").maybeSingle();
  return (data?.data as WeekShare) || null;
}

// Omar: only the snapshot Farah sent, and only for about a week after.
export async function weekForOmar(db: Db): Promise<WeekShare | null> {
  const w = await lastSent(db);
  return w && w.sentAt && Date.now() - w.sentAt < 8 * 86400000 ? w : null;
}

// Farah: "Send to Omar" saves today's numbers as a snapshot for his page.
export async function sendWeek(db: Db): Promise<WeekShare | null> {
  const w = await weekShare(db);
  if (!w) return null;
  const snap = { ...w, sentAt: Date.now() };
  await db.from(TABLE).upsert([{ owner: HOUSEHOLD, kind: "weekcard", id: "latest", data: snap, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  return snap;
}

export async function weekShare(db: Db): Promise<WeekShare | null> {
  const farah = (process.env.CAPTURE_EMAIL || "").trim().toLowerCase();
  const omar = omarEmail();
  const td = ymdIn(Date.now()), mon = mondayOf(td), sun = addDays(mon, 6), nextMon = addDays(mon, 7), nextSun = addDays(mon, 13);
  const [fTasks, fMeta, oTasks, shared, partner, sent] = await Promise.all([
    rows(db, farah, "tasks"), rows(db, farah, "meta"), rows(db, omar, "tasks"), listShared(db).catch(() => []), partnerDays(db, 14).catch(() => ({ days: [] as { date: string; kind: string }[] })), lastSent(db).catch(() => null),
  ]);
  const meta = (fMeta.find((m) => m.id === "main") || {}) as Doc;
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
    sentAt: sent && sent.mon === mon ? sent.sentAt : null,
    farah: { done: farahDone },
    omar: { done: omarOwn, household: omarHousehold, shifts: count(mon, sun, (k) => work.has(k)) },
    next: { mon: nextMon, nights: count(nextMon, nextSun, (k) => k === "night"), shifts: count(nextMon, nextSun, (k) => work.has(k)), planned: !!(sync[nextMon] && sync[nextMon].doneAt) },
  };
}
