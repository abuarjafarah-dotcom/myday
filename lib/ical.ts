// Minimal iCalendar (.ics) reader for public iCloud calendar feeds.
// Handles all-day, UTC, floating and TZID times (DST-correct), RRULE (daily, weekly, monthly, yearly),
// EXDATE, edited single occurrences (RECURRENCE-ID) and cancellations. No dependencies.

export type CalEvent = {
  id: string;
  title: string;
  start: string;      // all-day: YYYY-MM-DD; timed: ISO UTC
  end: string;
  allDay: boolean;
  calendar: string;
  color: string | null;
  source: "icloud";
};

type Prop = { name: string; params: Record<string, string>; value: string };
type Stamp = { naive: number; allDay: boolean; tz: string | null; utc: boolean };

const DAY = 86400000;
const WD = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

function parseLine(line: string): Prop | null {
  let inQ = false, i = 0;
  for (; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQ = !inQ;
    else if (ch === ":" && !inQ) break;
  }
  if (i >= line.length) return null;
  const head = line.slice(0, i), value = line.slice(i + 1);
  const parts = head.split(";");
  const params: Record<string, string> = {};
  parts.slice(1).forEach((p) => {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  });
  return { name: parts[0].toUpperCase(), params, value };
}

const unescapeText = (s: string) =>
  s.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function validTz(tz: string | undefined, fallback: string): string {
  if (!tz) return fallback;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return fallback; }
}

// Offset (ms) of `tz` from UTC at instant `ts`.
function tzOffset(ts: number, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, number> = {};
  f.formatToParts(new Date(ts)).forEach((x) => { if (x.type !== "literal") p[x.type] = Number(x.value); });
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - ts;
}

// Wall-clock time in `tz` (expressed as a naive UTC timestamp) -> real UTC timestamp.
function zonedToUtc(naive: number, tz: string): number {
  let utc = naive - tzOffset(naive, tz);
  const again = naive - tzOffset(utc, tz);
  if (again !== utc) utc = again;
  return utc;
}

function parseStamp(p: Prop, defaultTz: string): Stamp | null {
  const v = p.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h || p.params.VALUE === "DATE") {
    return { naive: Date.UTC(+y, +mo - 1, +d), allDay: true, tz: null, utc: false };
  }
  return {
    naive: Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0)),
    allDay: false,
    tz: z ? null : validTz(p.params.TZID, defaultTz),
    utc: !!z,
  };
}

const toUtc = (s: Stamp, naive = s.naive) => (s.utc || !s.tz ? naive : zonedToUtc(naive, s.tz));
const ymd = (naive: number) => new Date(naive).toISOString().slice(0, 10);

function parseDuration(v: string): number {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  const ms = ((+(m[2] || 0) * 7 + +(m[3] || 0)) * DAY) + ((+(m[4] || 0) * 60 + +(m[5] || 0)) * 60 + +(m[6] || 0)) * 1000;
  return m[1] === "-" ? -ms : ms;
}

type Rule = { freq: string; interval: number; count?: number; until?: number; byday: { n: number; wd: number }[]; bymonthday: number[] };

function parseRule(v: string, start: Stamp, defaultTz: string): Rule | null {
  const kv: Record<string, string> = {};
  v.split(";").forEach((x) => { const [k, val] = x.split("="); if (k && val) kv[k.toUpperCase()] = val; });
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(kv.FREQ)) return null;
  let until: number | undefined;
  if (kv.UNTIL) {
    const st = parseStamp({ name: "UNTIL", params: {}, value: kv.UNTIL }, defaultTz);
    if (st) until = st.allDay ? (start.allDay ? st.naive : toUtc({ ...start }, st.naive + DAY - 1)) : st.utc ? st.naive : toUtc({ ...st, tz: start.tz });
  }
  return {
    freq: kv.FREQ,
    interval: Math.max(1, parseInt(kv.INTERVAL || "1", 10) || 1),
    count: kv.COUNT ? parseInt(kv.COUNT, 10) : undefined,
    until,
    byday: (kv.BYDAY || "").split(",").filter(Boolean).map((x) => {
      const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/);
      return m ? { n: m[1] ? parseInt(m[1], 10) : 0, wd: WD.indexOf(m[2]) } : { n: 0, wd: -1 };
    }).filter((x) => x.wd >= 0),
    bymonthday: (kv.BYMONTHDAY || "").split(",").filter(Boolean).map((x) => parseInt(x, 10)).filter((x) => !isNaN(x)),
  };
}

// Naive start times of every occurrence, in order, until past `stopNaive` (or COUNT/UNTIL).
function* occurrences(start: Stamp, r: Rule, stopNaive: number): Generator<number> {
  const s = new Date(start.naive);
  const tod = start.naive - Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  let emitted = 0, guard = 0;
  const done = (naive: number) =>
    (r.count !== undefined && emitted >= r.count) ||
    (r.until !== undefined && (start.allDay ? naive : toUtc(start, naive)) > r.until) ||
    naive > stopNaive || ++guard > 20000;
  const emit = function* (naive: number) { if (naive >= start.naive) { emitted++; yield naive; } };

  if (r.freq === "DAILY") {
    for (let t = start.naive; !done(t); t += r.interval * DAY) yield* emit(t);
    return;
  }
  if (r.freq === "WEEKLY") {
    const days = r.byday.length ? r.byday.map((b) => b.wd) : [s.getUTCDay()];
    const order = days.map((d) => (d + 6) % 7).sort((a, b) => a - b);        // Monday-first weeks
    const weekStart = start.naive - tod - ((s.getUTCDay() + 6) % 7) * DAY;
    for (let w = weekStart; ; w += r.interval * 7 * DAY) {
      for (const off of order) {
        const t = w + off * DAY + tod;
        if (t < start.naive) continue;
        if (done(t)) return;
        yield* emit(t);
      }
    }
  }
  if (r.freq === "MONTHLY" || r.freq === "YEARLY") {
    const step = r.freq === "MONTHLY" ? r.interval : r.interval * 12;
    for (let k = 0; ; k += step) {
      const y = s.getUTCFullYear(), m = s.getUTCMonth() + k;
      const first = Date.UTC(y, m, 1), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const cands: number[] = [];
      if (r.freq === "MONTHLY" && r.byday.length) {
        r.byday.forEach(({ n, wd }) => {
          const firstWd = new Date(first).getUTCDay();
          const all: number[] = [];
          for (let d = 1 + ((wd - firstWd + 7) % 7); d <= dim; d += 7) all.push(d);
          const pick = n === 0 ? all : [n > 0 ? all[n - 1] : all[all.length + n]];
          pick.forEach((d) => { if (d) cands.push(d); });
        });
      } else if (r.freq === "MONTHLY" && r.bymonthday.length) {
        r.bymonthday.forEach((d) => { const dd = d > 0 ? d : dim + d + 1; if (dd >= 1 && dd <= dim) cands.push(dd); });
      } else if (s.getUTCDate() <= dim) cands.push(s.getUTCDate());
      if (first - DAY > stopNaive) return;
      for (const d of cands.sort((a, b) => a - b)) {
        const t = first + (d - 1) * DAY + tod;
        if (t < start.naive) continue;
        if (done(t)) return;
        yield* emit(t);
      }
      if (guard > 20000) return;
    }
  }
}

export function parseIcs(text: string, opts: { from: number; to: number; defaultTz?: string; fallbackName?: string }): CalEvent[] {
  const defaultTz = validTz(opts.defaultTz, "America/Chicago");
  const lines = unfold(text);
  let calName = opts.fallbackName || "iCloud", color: string | null = null;
  const raw: Prop[][] = [];
  let cur: Prop[] | null = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = []; continue; }
    if (line === "END:VEVENT") { if (cur) raw.push(cur); cur = null; continue; }
    const p = parseLine(line); if (!p) continue;
    if (cur) cur.push(p);
    else if (p.name === "X-WR-CALNAME" && p.value.trim()) calName = unescapeText(p.value);
    else if (p.name === "X-APPLE-CALENDAR-COLOR") { const m = p.value.match(/^#[0-9a-fA-F]{6}/); if (m) color = m[0]; }
  }

  type Ev = { uid: string; title: string; start: Stamp; durMs: number; rule: Rule | null; exdates: Set<number>; recurId: number | null; cancelled: boolean };
  const evs: Ev[] = [];
  for (const props of raw) {
    const get = (n: string) => props.find((p) => p.name === n);
    const ds = get("DTSTART"); if (!ds) continue;
    const start = parseStamp(ds, defaultTz); if (!start) continue;
    const de = get("DTEND"), du = get("DURATION");
    let durMs = start.allDay ? DAY : 0;
    if (de) { const e = parseStamp(de, defaultTz); if (e) durMs = start.allDay || e.allDay ? e.naive - start.naive : toUtc(e) - toUtc(start); }
    else if (du) durMs = parseDuration(du.value.trim());
    const rr = get("RRULE");
    const exdates = new Set<number>();
    props.filter((p) => p.name === "EXDATE").forEach((p) =>
      p.value.split(",").forEach((v) => { const st = parseStamp({ ...p, value: v }, defaultTz); if (st) exdates.add(st.allDay ? st.naive : toUtc(st)); }));
    const rid = get("RECURRENCE-ID");
    const ridSt = rid ? parseStamp(rid, defaultTz) : null;
    evs.push({
      uid: (get("UID")?.value || `${calName}-${evs.length}`).trim(),
      title: unescapeText(get("SUMMARY")?.value || "(No title)"),
      start, durMs: Math.max(0, durMs),
      rule: rr ? parseRule(rr.value, start, defaultTz) : null,
      exdates,
      recurId: ridSt ? (ridSt.allDay ? ridSt.naive : toUtc(ridSt)) : null,
      cancelled: (get("STATUS")?.value || "").trim().toUpperCase() === "CANCELLED",
    });
  }

  const overridden = new Set(evs.filter((e) => e.recurId !== null).map((e) => `${e.uid}|${e.recurId}`));
  const out: CalEvent[] = [];
  const push = (e: Ev, naive: number) => {
    if (e.start.allDay) {
      const endNaive = naive + Math.max(e.durMs, DAY);
      // All-day dates are calendar days; compare against the window generously (a day either side).
      if (endNaive < opts.from - DAY || naive > opts.to + DAY) return;
      out.push({ id: `icloud:${e.uid}:${ymd(naive)}`, title: e.title, start: ymd(naive), end: ymd(endNaive), allDay: true, calendar: calName, color, source: "icloud" });
    } else {
      const s = toUtc(e.start, naive), en = s + e.durMs;
      if (en < opts.from || s > opts.to) return;
      out.push({ id: `icloud:${e.uid}:${s}`, title: e.title, start: new Date(s).toISOString(), end: new Date(en).toISOString(), allDay: false, calendar: calName, color, source: "icloud" });
    }
  };

  // Generous naive stop point: wall time can differ from UTC by at most ~14h.
  const stopNaive = opts.to + 2 * DAY;
  for (const e of evs) {
    if (e.cancelled) continue;
    if (e.recurId !== null || !e.rule) { push(e, e.start.naive); continue; }
    for (const naive of occurrences(e.start, e.rule, stopNaive)) {
      const key = e.start.allDay ? naive : toUtc(e.start, naive);
      if (e.exdates.has(key) || overridden.has(`${e.uid}|${key}`)) continue;
      push(e, naive);
    }
  }
  return out;
}

// Reads ICLOUD_CALENDAR_URLS (comma, space or newline separated; webcal:// or https://).
export async function fetchIcloudEvents(from: number, to: number): Promise<CalEvent[]> {
  const urls = (process.env.ICLOUD_CALENDAR_URLS || "")
    .split(/[\s,]+/).map((u) => u.trim()).filter(Boolean)
    .map((u) => u.replace(/^webcals?:\/\//i, "https://"));
  const tz = process.env.CALENDAR_TIMEZONE || "America/Chicago";
  const lists = await Promise.all(urls.map(async (url, i) => {
    try {
      const r = await fetch(url, { next: { revalidate: 300 }, headers: { Accept: "text/calendar" } } as RequestInit);
      if (!r.ok) { console.error(`iCloud calendar ${i + 1}: HTTP ${r.status}`); return []; }
      return parseIcs(await r.text(), { from, to, defaultTz: tz, fallbackName: `iCloud ${i + 1}` });
    } catch (err) {
      console.error(`iCloud calendar ${i + 1} failed:`, err);
      return [];
    }
  }));
  return lists.flat();
}
