// Free, rule-based "smart filter" for spoken or typed capture. No API keys, no extra packages.
// Turns "There's a presentation on October 15th, high priority. Remind me a week before."
// into { kind: "task", title: "Presentation", priority: 1, due: "2026-10-15", remindOn: "2026-10-08" }.
// Handles several items in one message (one per sentence or line), trips ("Flying to Lisbon Oct 20 to 24"),
// notes ("Note: ..."), priorities, due dates, times and reminders.

export type Kind = "task" | "trip" | "note";
export type Category = "paper" | "slides" | "email" | "meeting" | "other";
export const CATEGORIES: Category[] = ["paper", "slides", "email", "meeting", "other"];

// Which kind of work a task is. Order matters: a "presentation" is slides even if it also says "review".
const CAT_RULES: [Category, RegExp][] = [
  ["slides", /\b(power ?points?|ppts?|slides?|slide deck|deck|keynote|presentation|present(?:ing)?|talk|grand rounds|lecture|poster|webinar)\b/i],
  ["paper", /\b(paper|papers|manuscript|article|abstract|draft|write[- ]?up|revis(?:e|ion|ions)|resubmi(?:t|ssion)|journal|reviewer|peer review|proofs?|grant|proposal|irb|protocol|chapter|publication|submission|letter of (?:rec|recommendation|support)|cover letter|report)\b/i],
  ["email", /\b(e-?mails?|reply|respond|follow[- ]?up|write (?:back|to)|send (?:a |an )?(?:note|message)|message|inbox|get back to|cc)\b/i],
  ["meeting", /\b(meeting|meet with|meet|call with|call|zoom|teams|1:1|one[- ]on[- ]one|sync|huddle|conference call|appointment|appt|committee|rounds|interview|check[- ]in|catch up)\b/i],
];

// Starts with an email verb ("Reply to the editor", "Email Dr. Smith") -> email, whatever it is about.
const EMAIL_LEAD = /^\s*(?:please\s+)?(?:e-?mail|reply|respond|write back|follow[- ]?up|get back to|answer|forward)\b/i;

export function categorize(text: string): Category {
  if (/\b(?:power ?points?|ppts?|slides?|slide deck|presentation)\b/i.test(text)) return "slides";
  if (EMAIL_LEAD.test(text)) return "email";
  for (const [cat, re] of CAT_RULES) if (re.test(text)) return cat;
  return "other";
}
export type Parsed = {
  kind: Kind;
  title: string;
  priority: 1 | 2 | 3;
  category: Category;
  due: string | null;          // YYYY-MM-DD
  time: string | null;         // "3:00 PM"
  remindOn: string | null;     // YYYY-MM-DD
  remindAdjusted?: boolean;    // the asked-for reminder day had already passed, so it moved to today
  destination?: string;
  start?: string;              // trips
  end?: string;
  text: string;                // what was said, for reference
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD_RE = "(sun|mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?)(?:day)?";
const ORD = "(?:st|nd|rd|th)?";
const NUMWORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  "a couple of": 2, "a couple": 2, couple: 2, "a few": 3, few: 3,
};
const NUM_RE = "(\\d{1,2}|a couple of|a couple|a few|an?|one|two|three|four|five|six|seven|eight|nine|ten)";
const num = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUMWORDS[s.toLowerCase()] ?? 1);

const pad2 = (n: number) => String(n).padStart(2, "0");
const parseYmd = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const fmtYmd = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
export const addDays = (s: string, n: number) => { const d = parseYmd(s); d.setUTCDate(d.getUTCDate() + n); return fmtYmd(d); };
const validYmd = (y: number, m: number, d: number) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const monthNum = (s: string) => MONTHS.indexOf(s.toLowerCase().slice(0, 3)) + 1;
const wdNum = (s: string) => WEEKDAYS.findIndex((w) => w.startsWith(s.toLowerCase().slice(0, 3)));

export function localToday(tz = "America/Chicago", at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return localToday("America/Chicago", at);
  }
}

// Month and day with no year: this year, or next year if it is already more than a month behind us.
function ymdFrom(m: number, d: number, today: string, year?: number): string | null {
  let y = year ?? parseYmd(today).getUTCFullYear();
  if (!validYmd(y, m, d)) return null;
  if (year === undefined && `${y}-${pad2(m)}-${pad2(d)}` < addDays(today, -30)) y += 1;
  return validYmd(y, m, d) ? `${y}-${pad2(m)}-${pad2(d)}` : null;
}

type Hit = { date: string; index: number; length: number; end?: string };

// Finds the first date in the text. Returns where it was, so it can be cut out of the title.
export function findDate(text: string, today: string): Hit | null {
  const hits: Hit[] = [];
  const add = (re: RegExp, fn: (m: RegExpExecArray) => { date: string | null; end?: string | null }) => {
    const m = re.exec(text);
    if (!m) return;
    const r = fn(m);
    if (r.date) hits.push({ date: r.date, index: m.index, length: m[0].length, ...(r.end ? { end: r.end } : {}) });
  };
  const cur = parseYmd(today).getUTCDay();

  add(/\b(20\d{2})-(\d{2})-(\d{2})\b/, (m) => ({ date: validYmd(+m[1], +m[2], +m[3]) ? m[0] : null }));
  // "October 20 to 24", "Oct 20 - Oct 24", "October 20th through the 24th"
  add(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}(?:,?\\s*(20\\d{2}))?\\s*(?:-|–|—|to|through|thru|until|till)\\s*(?:the\\s+)?(?:${MONTH_RE}\\s+)?(\\d{1,2})${ORD}(?:,?\\s*(20\\d{2}))?\\b`, "i"), (m) => {
    const m1 = monthNum(m[1]), y = m[3] ? +m[3] : undefined;
    const start = ymdFrom(m1, +m[2], today, y);
    const m2 = m[4] ? monthNum(m[4]) : m1;
    let end = start ? ymdFrom(m2, +m[5], today, m[6] ? +m[6] : y) : null;
    if (start && end && end < start) end = ymdFrom(m2, +m[5], addDays(start, 1), parseYmd(start).getUTCFullYear() + 1);
    return { date: start, end };
  });
  // "October 15th", "Oct 15, 2026"
  add(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})${ORD}(?:,?\\s*(20\\d{2}))?\\b`, "i"), (m) => ({ date: ymdFrom(monthNum(m[1]), +m[2], today, m[3] ? +m[3] : undefined) }));
  // "15th of October", "the 15th October"
  add(new RegExp(`\\b(?:the\\s+)?(\\d{1,2})${ORD}\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s*(20\\d{2}))?\\b`, "i"), (m) => ({ date: ymdFrom(monthNum(m[2]), +m[1], today, m[3] ? +m[3] : undefined) }));
  // 10/15 or 10/15/2026
  add(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, (m) => {
    let y = m[3] ? +m[3] : undefined;
    if (y !== undefined && y < 100) y += 2000;
    return { date: ymdFrom(+m[1], +m[2], today, y) };
  });
  add(/\bday after tomorrow\b/i, () => ({ date: addDays(today, 2) }));
  add(/\btomorrow\b/i, () => ({ date: addDays(today, 1) }));
  add(/\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i, () => ({ date: today }));
  add(new RegExp(`\\bin\\s+${NUM_RE}\\s+(day|days|week|weeks)\\b`, "i"), (m) => ({ date: addDays(today, num(m[1]) * (/week/i.test(m[2]) ? 7 : 1)) }));
  add(/\b(?:by\s+)?(?:the\s+)?end of (?:the |this )?week\b/i, () => ({ date: addDays(today, (5 - cur + 7) % 7) }));
  add(/\b(?:by\s+)?(?:the\s+)?end of (?:the |this )?month\b/i, () => {
    const d = parseYmd(today);
    return { date: fmtYmd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
  });
  add(/\bnext week\b/i, () => ({ date: addDays(today, ((1 - cur + 7) % 7) || 7) }));
  add(new RegExp(`\\b(next|this|coming)?\\s*${WD_RE}\\b`, "i"), (m) => {
    const wd = wdNum(m[2]);
    if (wd < 0) return { date: null };
    let delta = (wd - cur + 7) % 7;
    if ((m[1] || "").toLowerCase() === "next" && delta === 0) delta = 7;
    return { date: addDays(today, delta) };
  });

  if (!hits.length) return null;
  // Earliest in the sentence wins; at the same spot, the longest (a range beats its start date).
  hits.sort((a, b) => a.index - b.index || b.length - a.length);
  return hits[0];
}

function findTime(text: string): { time: string; index: number; length: number } | null {
  const m = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?(?=\W|$)/i.exec(text) || /\bat\s+(\d{1,2}):(\d{2})\b()/i.exec(text) || /\b(noon|midnight)\b()()/i.exec(text);
  if (!m) return null;
  let h: number, mi: number;
  if (/noon/i.test(m[1])) { h = 12; mi = 0; }
  else if (/midnight/i.test(m[1])) { h = 0; mi = 0; }
  else {
    h = Number(m[1]); mi = Number(m[2] || 0);
    const ap = (m[3] || "").toLowerCase();
    if (h > 23 || mi > 59) return null;
    if (ap === "p" && h < 12) h += 12;
    if (ap === "a" && h === 12) h = 0;
  }
  const time = `${((h + 11) % 12) + 1}:${pad2(mi)} ${h >= 12 ? "PM" : "AM"}`;
  return { time, index: m.index, length: m[0].length };
}

const HIGH = /\b(high[\s-]?priority|top priority|priority one|p ?1|urgent|urgently|asap|as soon as possible|critical|important|very important|must do|crucial)\b/i;
const LOW = /\b(low[\s-]?priority|priority three|p ?3|not urgent|no rush|whenever|someday|some day|if (?:i|there's|there is) time|nice to have)\b/i;
const MEDIUM = /\b(medium[\s-]?priority|normal priority|priority two|p ?2)\b/i;
const DEADLINE = /\b(deadline|due|submit|submission|presentation|present|exam|interview|grant|abstract|board|review|defen[cs]e|certification|renewal|license|licence|tax|taxes)\b/i;

const TRAVEL = /\b(fly|flying|flight|flights|travel|travell?ing|trip|vacation|holiday|heading to|going to|land(?:ing)? in|arriv(?:e|ing) in|visit(?:ing)?|conference in|meeting in|layover)\b/i;
const NOT_PLACE = new RegExp(`^(?:${MONTH_RE}|${WD_RE}|the|a|an|my|our|his|her|work|home|school|church|bed|sleep|today|tomorrow|tonight|next|this|i|we|it|airport)$`, "i");
const NOTE = /^\s*(?:note(?:\s+to\s+self)?|remember that|fyi|f\.y\.i\.|idea|thought)\b[:,]?\s*/i;

// "Remind me a week before", "set a reminder 3 days before that", "remind me on October 10", "remind me tomorrow".
const REMIND_REL = new RegExp(`(?:(?:,\\s*)?(?:and\\s+)?(?:i\\s+(?:want|would like|need)\\s+(?:you\\s+)?to|i'd like (?:you )?to|can you|could you)\\s+)?\\b(?:please\\s+)?(?:remind me|set (?:up )?(?:a )?reminders?|reminder|alert me|ping me|notify me)\\s*(?:to\\s+\\w+\\s+)?(?:about it\\s+|about that\\s+)?(?:${NUM_RE}\\s+(day|days|week|weeks)|the (day|week))\\s+(?:before|ahead|earlier|prior)(?:\\s+(?:that|it|then|the (?:date|deadline|day|event|presentation|trip|meeting)))?\\b`, "i");
const REMIND_ANY = /(?:(?:,\s*)?(?:and\s+)?(?:i\s+(?:want|would like|need)\s+(?:you\s+)?to|i'd like (?:you )?to|can you|could you)\s+)?\b(?:please\s+)?(?:remind me|set (?:up )?(?:a )?reminders?|reminder|alert me|ping me|notify me)\b(?:\s+(?:about (?:it|that|this)|of (?:it|that|this)|on|for|to|at))*/i;

function capitalize(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Removes a matched piece and a little word right before it ("on", "by", "due") so titles read cleanly.
function cut(text: string, index: number, length: number): string {
  const before = text.slice(0, index).replace(/\b(?:on|by|due(?:\s+(?:on|by))?|before|until|from|for|at|starting|this|the)\s*$/i, "");
  return (before + " " + text.slice(index + length)).replace(/\s{2,}/g, " ");
}

function cleanTitle(s: string): string {
  let t = s
    .replace(/^\s*(?:ok(?:ay)?|so|um+|uh+|hey|please)[,\s]+/i, "")
    .replace(/^\s*(?:add|create|new|make)\s+(?:a\s+)?(?:task|to-?do|item|reminder)\s*(?:to|for|:)?\s*/i, "")
    .replace(/^\s*(?:to-?do|task)\s*[:,-]?\s*/i, "")
    .replace(/^\s*(?:there(?:'s| is| will be)|i(?:'ve| have)(?: got)?|we have|i've got|got)\s+(?:a|an|the|my)?\s*/i, "")
    .replace(/^\s*(?:i\s+)?(?:need|have|got|must|should|want)\s+to\s+/i, "")
    .replace(/^\s*(?:don't|do not)\s+forget\s+(?:to\s+)?/i, "")
    .replace(/^\s*make sure\s+(?:i|to)\s+/i, "")
    .replace(/^\s*to\s+(?=\w)/i, "")
    .replace(/\b(?:it(?:'s| is)|this is|that(?:'s| is)|make it|mark (?:it|as))\s*(?:a\s+)?$/i, "")
    .replace(/[,;:\-–—]+\s*$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  for (let i = 0; i < 4; i++) {
    t = t.replace(/\s*\b(?:on|by|due|for|before|at|the|this|next|from|until|to|and|with|is|it's|it is|that|which|a|an)\s*$/i, "").replace(/[,;:\-–—.]+\s*$/g, "").trim();
  }
  return capitalize(t.replace(/^[,;:\-–—.\s]+/, ""));
}

function findPlace(text: string): { place: string; index: number; length: number } | null {
  const re = /\b(?:to|in|for|visit(?:ing)?|at)\s+((?:[A-Z][\p{L}'’.-]*)(?:[ ,]+(?:[A-Z][\p{L}'’.-]*|de|da|do|del|di|la|le|el|of|upon|on)){0,4})/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const words = m[1].replace(/,+\s*$/, "").split(/[ ,]+/);
    while (words.length && /^(?:de|da|do|del|di|la|le|el|of|upon|on)$/.test(words[words.length - 1])) words.pop();
    // Stop at a month or weekday: "Lisbon October 20" -> "Lisbon".
    const cutAt = words.findIndex((w) => NOT_PLACE.test(w.replace(/[.,]$/, "")));
    const keep = (cutAt === -1 ? words : words.slice(0, cutAt)).filter(Boolean);
    if (!keep.length) continue;
    const place = keep.join(" ").replace(/[.,]+$/, "");
    if (place.length < 2) continue;
    return { place, index: m.index, length: m[0].length };
  }
  return null;
}

function stayLength(text: string): number | null {
  const m = new RegExp(`\\bfor\\s+${NUM_RE}\\s+(day|days|night|nights|week|weeks)\\b`, "i").exec(text);
  if (!m) return null;
  const n = num(m[1]);
  return /week/i.test(m[2]) ? n * 7 : /night/i.test(m[2]) ? n : Math.max(0, n - 1);
}

// Split a message into items: lines and sentences. Abbreviations like "Oct." do not split.
export function splitItems(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n+|(?<!\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|dr|mr|mrs|ms|st|vs|etc|a\.m|p\.m))[.!?;](?=\s|$)|\s+(?:and then|after that)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.replace(/[\s.,;!?]/g, "").length > 0);
}

function parseOne(raw: string, today: string, trips = true): Parsed & { reminderOnly?: boolean; remindOffset?: number; remindExplicit?: string | null; remindLoose?: boolean } {
  let text = raw.trim();
  const out: Parsed & { reminderOnly?: boolean; remindOffset?: number; remindExplicit?: string | null; remindLoose?: boolean } = {
    kind: "task", title: "", category: "other", priority: 2, due: null, time: null, remindOn: null, text: raw.trim(),
  };

  // Reminders come off first so their dates don't become the due date.
  const rel = REMIND_REL.exec(text);
  if (rel) {
    out.remindOffset = rel[1] ? num(rel[1]) * (/week/i.test(rel[2]) ? 7 : 1) : /week/i.test(rel[3] || "") ? 7 : 1;
    text = (text.slice(0, rel.index) + " " + text.slice(rel.index + rel[0].length)).replace(/\s{2,}/g, " ");
  } else {
    const any = REMIND_ANY.exec(text);
    if (any) {
      const after = text.slice(any.index + any[0].length);
      const d = findDate(after, today);
      // "remind me on Oct 10 about the visa" -> reminder on Oct 10. A date further on belongs to the task.
      if (d && d.index <= 4) {
        out.remindExplicit = d.date;
        text = text.slice(0, any.index) + " " + after.slice(0, d.index) + " " + after.slice(d.index + d.length);
      } else {
        out.remindLoose = true;
        text = text.slice(0, any.index) + " " + after;
      }
      text = text.replace(/\s{2,}/g, " ");
    }
  }

  if (NOTE.test(text)) {
    out.kind = "note";
    text = text.replace(NOTE, "");
  }

  // Priority
  if (HIGH.test(text)) { out.priority = 1; text = text.replace(HIGH, " "); }
  else if (LOW.test(text)) { out.priority = 3; text = text.replace(LOW, " "); }
  else if (MEDIUM.test(text)) { out.priority = 2; text = text.replace(MEDIUM, " "); }
  else if (DEADLINE.test(text)) out.priority = 1;
  text = text.replace(/\b(?:it(?:'s| is)|make it|mark it(?: as)?|this is)\s*(?:a\s+)?(?=[,.\s]*$)/i, " ").replace(/\s{2,}/g, " ");

  // Time
  const tm = findTime(text);
  if (tm) { out.time = tm.time; text = cut(text, tm.index, tm.length); }

  // Date (and range for trips)
  const dt = findDate(text, today);
  let rangeEnd: string | null = null;
  if (dt) {
    out.due = dt.date;
    rangeEnd = dt.end || null;
    text = cut(text, dt.index, dt.length);
  }

  // Trip?
  if (trips && out.kind === "task" && TRAVEL.test(raw)) {
    const pl = findPlace(text);
    if (pl) {
      out.kind = "trip";
      out.destination = pl.place;
      out.start = out.due || undefined;
      const stay = stayLength(raw);
      out.end = rangeEnd || (out.due && stay !== null ? addDays(out.due, stay) : out.due) || undefined;
      text = text.replace(new RegExp(`\\bfor\\s+${NUM_RE}\\s+(?:day|days|night|nights|week|weeks)\\b`, "i"), " ");
      out.title = `Trip to ${pl.place}`;
      if (out.priority === 1 && !HIGH.test(raw)) out.priority = 2;
    }
  }

  if (!out.title) out.title = cleanTitle(text);
  out.category = categorize(raw);
  if (!out.title && (rel || out.remindExplicit !== undefined || out.remindLoose)) out.reminderOnly = true;
  return out;
}

function settleReminder(p: ReturnType<typeof parseOne>, today: string): void {
  let on: string | null = null;
  if (p.remindOffset !== undefined) {
    const anchor = p.kind === "trip" ? p.start || p.due : p.due;
    on = anchor ? addDays(anchor, -p.remindOffset) : null;
  } else if (p.remindExplicit) on = p.remindExplicit;
  else if (p.remindLoose) {
    // "Remind me" with no timing: the day before it's due, or tomorrow if there is no date.
    const anchor = p.kind === "trip" ? p.start || p.due : p.due;
    on = anchor ? (anchor > today ? addDays(anchor, -1) : today) : addDays(today, 1);
  }
  if (on && on < today) {
    on = today;
    p.remindAdjusted = true;
  }
  p.remindOn = on;
}

// opts.trips = false: no trip detection (Farah's errands like "going to Target" stay tasks).
// opts.split = false: treat the text as one item (the caller already split it).
export function parseCapture(text: string, today: string, opts: { trips?: boolean; split?: boolean } = {}): Parsed[] {
  const items: ReturnType<typeof parseOne>[] = [];
  const pieces = opts.split === false ? [text.trim()].filter(Boolean) : splitItems(text).slice(0, 20);
  for (const piece of pieces) {
    const p = parseOne(piece, today, opts.trips !== false);
    // "Remind me a week before." on its own line belongs to the item before it.
    if (p.reminderOnly && items.length) {
      const prev = items[items.length - 1];
      prev.remindOffset = p.remindOffset;
      prev.remindExplicit = p.remindExplicit;
      prev.remindLoose = p.remindLoose;
      if (p.priority !== 2 && prev.priority === 2) prev.priority = p.priority;
      prev.text = `${prev.text}. ${p.text}`;
      continue;
    }
    if (p.reminderOnly) p.title = "Reminder";
    if (!p.title) continue;
    items.push(p);
  }
  return items.map((p) => {
    settleReminder(p, today);
    const { reminderOnly: _a, remindOffset: _b, remindExplicit: _c, remindLoose: _d, ...clean } = p;
    void _a; void _b; void _c; void _d;
    if (clean.kind === "trip" && !clean.due) clean.due = clean.start || null;
    return clean as Parsed;
  });
}

// "Oct 8, 2026 at 8:00 AM" — the iPhone Shortcuts app reads this as a date.
export function humanWhen(ymd: string, time = "8:00 AM"): string {
  const d = parseYmd(ymd);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${mon} ${d.getUTCDate()}, ${d.getUTCFullYear()} at ${time}`;
}

export const _test = { findDate, findPlace, cleanTitle, escapeRe };
