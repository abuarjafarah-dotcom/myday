// Shared helpers for reading Gmail messages: body text and due dates.

export type GmailPart = { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] };

export function decode(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

export function findPart(p: GmailPart | undefined, mime: string): string {
  if (!p) return "";
  if (p.mimeType === mime && p.body?.data) return decode(p.body.data);
  for (const c of p.parts || []) {
    const r = findPart(c, mime);
    if (r) return r;
  }
  return "";
}

export function stripHtml(h: string): string {
  return h
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>|<\/tr>|<\/h\d>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// ---------- dates ----------
export const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const pad2 = (n: number) => String(n).padStart(2, "0");

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function fmtYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
export function addDaysYmd(s: string, n: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtYmd(d);
}
export function validYmd(y: number, m: number, d: number): boolean {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Finds a due date in a sentence: 2026-10-14, 10/14, "Oct 14", "by Friday", "tomorrow".
export function parseDue(text: string, today: string): string | null {
  const l = text.toLowerCase();
  const ty = parseYmd(today).getUTCFullYear();
  const iso = l.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso && validYmd(+iso[1], +iso[2], +iso[3])) return iso[0];
  const monthName = l.match(new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`));
  if (monthName) {
    const m = MONTHS.indexOf(monthName[1]) + 1;
    const d = +monthName[2];
    let y = ty;
    if (validYmd(y, m, d) && fmtYmd(new Date(Date.UTC(y, m - 1, d))) < addDaysYmd(today, -30)) y += 1;
    if (validYmd(y, m, d)) return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  const slash = l.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slash) {
    const m = +slash[1];
    const d = +slash[2];
    let y = slash[3] ? +slash[3] : ty;
    if (y < 100) y += 2000;
    if (validYmd(y, m, d)) return `${y}-${pad2(m)}-${pad2(d)}`;
  }
  if (/\btomorrow\b/.test(l)) return addDaysYmd(today, 1);
  if (/\btoday\b|\btonight\b/.test(l)) return today;
  const cur = parseYmd(today).getUTCDay();
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b`).test(l)) return addDaysYmd(today, (i - cur + 7) % 7);
  }
  return null;
}

