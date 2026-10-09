// Turns a calendar into one label per day: night shift, day shift, on call, admin, traveling, off, meetings.
// Used for the "Omar today" strip on Farah's dashboard. Only the label leaves this file, never event details.

export type Ev = { title: string; start: string; end?: string; allDay?: boolean; location?: string };
export type Trip = { destination?: string; start?: string | null; end?: string | null };
export type DayKind = "night" | "postnight" | "oncall" | "day" | "admin" | "travel" | "off" | "meetings" | "free";
export type DayStatus = { date: string; kind: DayKind; label: string; emoji: string; meetings: number; place?: string };

const TZ = process.env.CALENDAR_TIMEZONE || "America/Chicago";

const NIGHT = /\b(night|nights|noc|overnight|nocturnist|night float)\b/i;
const ONCALL = /\b(on[- ]?call|call night|home call|backup call)\b/i;
const SHIFT = /\b(shift|service|icu|micu|sicu|ccu|cvicu|nicu|picu|ward|wards|clinic|attending|rounds|hospital|inpatient|consults?|or day|procedure day|cath lab|ed shift)\b/i;
const ADMIN = /\b(admin|administrative|academic|research day|non[- ]?clinical|office day|cme|protected time)\b/i;
const OFF = /\b(off|day off|pto|vacation|holiday|leave|ooo|out of office)\b/i;
const TRAVEL = /(✈|\bflight\b|\bfly(ing)?\b|\btravel|\btrip\b|\bconference\b|\bcongress\b|\bsummit\b|\bmeeting in\b)/i;

const LABEL: Record<DayKind, [string, string]> = {
  night: ["Night shift", "🌙"],
  postnight: ["Post-night (sleeping)", "😴"],
  oncall: ["On call", "📟"],
  day: ["Day shift", "☀️"],
  admin: ["Admin day", "🗂️"],
  travel: ["Traveling", "✈️"],
  off: ["Off", "🏖️"],
  meetings: ["Meetings", "👥"],
  free: ["No schedule", "·"],
};

function ymdIn(ts: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
}
function hourIn(ts: number): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(new Date(ts))) % 24;
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function place(title: string, location?: string): string | undefined {
  const m = title.match(/\b(?:to|in)\s+([A-Z][\p{L}'’.-]*(?:\s+[A-Z][\p{L}'’.-]*){0,2})/u);
  if (m) return m[1];
  const loc = (location || "").split(",").map((x) => x.trim()).find((x) => x && !/\d|airport|terminal|hotel/i.test(x));
  return loc || undefined;
}

export function dayStatuses(events: Ev[], trips: Trip[], days = 7, from: string = ymdIn(Date.now())): DayStatus[] {
  const out: DayStatus[] = [];
  const kinds = new Map<string, Set<DayKind>>();
  const meetings = new Map<string, number>();
  const places = new Map<string, string>();
  const add = (d: string, k: DayKind) => { if (!kinds.has(d)) kinds.set(d, new Set()); kinds.get(d)!.add(k); };

  for (const e of events) {
    const title = String(e.title || "");
    if (e.allDay) {
      const s = String(e.start).slice(0, 10), en = String(e.end || e.start).slice(0, 10);
      for (let d = s; d < (en > s ? en : addDays(s, 1)); d = addDays(d, 1)) {
        if (TRAVEL.test(title)) { add(d, "travel"); const p = place(title, e.location); if (p) places.set(d, p); }
        else if (NIGHT.test(title)) add(d, "night");
        else if (ONCALL.test(title)) add(d, "oncall");
        else if (ADMIN.test(title)) add(d, "admin");
        else if (OFF.test(title)) add(d, "off");
        else if (SHIFT.test(title)) add(d, "day");
      }
      continue;
    }
    const s = Date.parse(e.start), en = Date.parse(e.end || e.start);
    if (isNaN(s)) continue;
    const d = ymdIn(s), hours = Math.max(0, (en - s) / 3600000), h = hourIn(s);
    if (TRAVEL.test(title) && /✈|\bflight\b|\bfly/i.test(title)) { add(d, "travel"); const p = place(title, e.location); if (p) places.set(d, p); continue; }
    if (NIGHT.test(title) || (h >= 17 && hours >= 8)) { add(d, "night"); add(addDays(d, 1), "postnight"); continue; }
    if (ONCALL.test(title)) { add(d, "oncall"); continue; }
    if (ADMIN.test(title)) { add(d, "admin"); continue; }
    if (OFF.test(title) && hours >= 6) { add(d, "off"); continue; }
    if (SHIFT.test(title) || hours >= 7) { add(d, "day"); continue; }
    meetings.set(d, (meetings.get(d) || 0) + 1);
  }
  for (const t of trips) {
    if (!t.start) continue;
    const end = t.end && t.end >= t.start ? t.end : t.start;
    for (let d = t.start; d <= end; d = addDays(d, 1)) { add(d, "travel"); if (t.destination) places.set(d, t.destination); }
  }

  const ORDER: DayKind[] = ["travel", "night", "oncall", "day", "postnight", "admin", "off"];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const ks = kinds.get(date) || new Set<DayKind>();
    const n = meetings.get(date) || 0;
    let kind: DayKind = ORDER.find((k) => ks.has(k)) || (n ? "meetings" : "free");
    // A night shift that starts the same evening after a post-night morning still reads "Night shift".
    if (kind === "postnight" && ks.has("night")) kind = "night";
    const [label, emoji] = LABEL[kind];
    out.push({ date, kind, label, emoji, meetings: n, ...(kind === "travel" && places.get(date) ? { place: places.get(date) } : {}) });
  }
  return out;
}

export function statusLine(s: DayStatus): string {
  const extra = s.kind === "travel" && s.place ? ` (${s.place})` : "";
  const m = s.meetings && s.kind !== "meetings" ? ` + ${s.meetings} meeting${s.meetings === 1 ? "" : "s"}` : s.kind === "meetings" ? ` (${s.meetings})` : "";
  return `${s.emoji} ${s.label}${extra}${m}`;
}

// Reduces an event to what the day label needs. Titles are replaced by a generic word, so nothing private is stored.
export function sanitize(e: Ev): Ev {
  const t = String(e.title || "");
  let title = "meeting";
  if (TRAVEL.test(t)) title = `${/✈|\bflight\b|\bfly/i.test(t) ? "Flight" : "Trip"}${place(t, e.location) ? ` to ${place(t, e.location)}` : ""}`;
  else if (NIGHT.test(t)) title = "Night";
  else if (ONCALL.test(t)) title = "On call";
  else if (ADMIN.test(t)) title = "Admin";
  else if (OFF.test(t)) title = "Off";
  else if (SHIFT.test(t)) title = "Shift";
  return { title, start: e.start, end: e.end, allDay: !!e.allDay };
}
