import { createHash } from "node:crypto";
import { findDate, addDays } from "@/lib/smart";

// School email radar: reads school emails and pulls out dated events the family has to plan around
// (no school, early release, picture day, dress-up days, field trips, conferences, class events, things to bring),
// each with a prep task for the evening before when there is something to get ready. Rules only, no paid API.

export type SchoolKind = "noschool" | "early" | "picture" | "dress" | "trip" | "conference" | "event" | "bring";
export type SchoolItem = {
  id: string;
  kind: SchoolKind;
  icon: string;
  title: string;
  date: string;
  end: string | null;        // last day, for multi-day breaks
  time: string | null;
  prep: { title: string; date: string } | null;
  mailId: string;
  subject: string;
  from: string;
};
export type SchoolMail = { id: string; subject: string; from: string; body: string };

const COLORS = "red|orange|yellow|green|blue|purple|pink|black|white|gold|maroon|brown|gray|grey";
type Rule = { kind: SchoolKind; re: RegExp; icon: string; title: (m: RegExpMatchArray, line: string) => string; prep?: (title: string, line: string) => string | null };

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RULES: Rule[] = [
  { kind: "noschool", icon: "🏠", re: /\b(no school|schools? (?:is |are |will be )?closed|no classes|teacher (?:work(?:shop)?|in-?service|planning|prep|professional) days?|in-?service day|staff development day|non-?student day|(fall|winter|spring|thanksgiving|mid-?winter|holiday) break|snow day)\b/i,
    title: (m) => (m[2] ? `${cap(m[2].toLowerCase())} break: no school` : "No school") },
  { kind: "early", icon: "🕛", re: /\b(early (?:release|dismissal|out)|half[- ]day|minimum day)\b/i, title: () => "Early release",
    prep: () => "Plan early pickup" },
  { kind: "picture", icon: "📸", re: /\b(picture day|photo day|school (?:photos?|pictures)|picture retakes?)\b/i, title: (m) => (/retake/i.test(m[0]) ? "Picture retakes" : "Picture day"),
    prep: () => "Lay out picture day outfit" },
  { kind: "trip", icon: "🚌", re: /\bfield trip\b/i, title: () => "Field trip", prep: () => "Pack for the field trip (lunch, slip, layers)" },
  { kind: "conference", icon: "👩‍🏫", re: /\b(parent[- ]teacher conferences?|conferences? (?:are|will be|day|week|night)|family conferences?)\b/i, title: () => "Parent-teacher conference" },
  { kind: "dress", icon: "👕", re: new RegExp(`\\b(pajama day|pj day|crazy (?:hair|sock) day|hat day|spirit (?:day|week)|jersey day|twin day|costume (?:day|parade)|dress (?:up )?(?:day|as)|wear (?:your |something |a )?(?:${COLORS})(?: and (?:${COLORS}))?|(?:${COLORS}) (?:and (?:${COLORS}) )?day|halloween parade)\\b`, "i"),
    title: (m) => cap(m[1].toLowerCase()), prep: (t) => `Lay out: ${t.toLowerCase()}` },
  { kind: "event", icon: "🎉", re: /\b((?:harvest|fall|spring|winter) (?:fest(?:ival)?|party|celebration|concert|program)|class party|holiday party|book fair|school (?:concert|play|program)|family (?:night|fun night|picnic)|open house|performance|recital|pumpkin patch|apple orchard)\b/i,
    title: (m) => cap(m[1].toLowerCase()) },
  { kind: "bring", icon: "🎒", re: /\b(?:please )?(?:bring|send in|pack)\s+(?:a |an |your child'?s? |their |one )?([a-z][a-z ,'&-]{2,40}?)(?=\s+(?:to school|for|on|by|this|next|tomorrow)\b|[.!,;\n]|$)/i,
    title: (m) => `Bring ${m[1].trim().replace(/\s+/g, " ")}`, prep: (t) => `Pack: ${t.replace(/^Bring /, "")}` },
];

const EXPLICIT = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}\/\d{1,2}\b|\b20\d{2}-\d{2}-\d{2}\b/i;
const WEEKDAY = /\b(mon|tues|wednes|thurs|fri|satur|sun)day\b,?/gi;
const TIME = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/i;
const FOOTER = /unsubscribe|privacy policy|all rights reserved|manage (your )?preferences|view (this )?(email )?in (your )?browser/i;

function timeOf(line: string): string | null {
  const m = line.match(TIME);
  return m ? `${Number(m[1])}:${m[2] || "00"} ${m[3].toUpperCase()}M` : null;
}
const idOf = (...parts: string[]) => createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);

export function extractSchool(mails: SchoolMail[], today: string): SchoolItem[] {
  const out: SchoolItem[] = [];
  const seen = new Set<string>();
  const horizon = addDays(today, 120);
  for (const m of mails) {
    const lines = `${m.subject}\n${m.body}`
      .split(/\n+|(?<=[.!?])\s+(?=[A-Z])/)
      .map((x) => x.replace(/^[-*•>\s]+/, "").trim())
      .filter((x) => x.length >= 6 && x.length <= 300 && !FOOTER.test(x));
    // A heading date ("Friday, Oct 17") applies to the lines under it until the next date.
    let carry: { date: string; end?: string | null } | null = null;
    for (const line of lines) {
      // "Friday, October 17": the written date wins over the weekday name.
      const dated = EXPLICIT.test(line) ? line.replace(WEEKDAY, " ") : line;
      const hit = findDate(dated, today);
      if (hit) carry = { date: hit.date, end: hit.end || null };
      for (const r of RULES) {
        const mm = line.match(r.re);
        if (!mm) continue;
        if (r.kind === "noschool" && /\b(no school (?:supplies|lunch)|open|regular)\b/i.test(line)) continue;
        const when = hit || carry;
        if (!when) continue;
        const date = when.date, end = when.end && when.end > date ? when.end : null;
        if ((end || date) < today || date > horizon) continue;
        const title = r.title(mm, line).slice(0, 60);
        const key = `${r.kind}|${date}|${r.kind === "bring" || r.kind === "dress" || r.kind === "event" ? title.toLowerCase() : ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const prepTitle = r.prep ? r.prep(title, line) : null;
        const prepDate = addDays(date, -1);
        out.push({
          id: idOf(key),
          kind: r.kind,
          icon: r.icon,
          title,
          date,
          end,
          time: r.kind === "early" || r.kind === "conference" || r.kind === "event" ? timeOf(line) : null,
          prep: prepTitle && prepDate >= today ? { title: prepTitle.slice(0, 70), date: prepDate } : null,
          mailId: m.id,
          subject: m.subject.slice(0, 100),
          from: m.from.slice(0, 60),
        });
        if (r.kind !== "bring") break;     // one event per line, except things to bring alongside it
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 30);
}

// Gmail search for school mail: the senders she lists, plus words schools use.
export function schoolQuery(senders: string[]): string {
  const words = ['"no school"', '"early release"', '"early dismissal"', '"picture day"', '"field trip"', '"pajama day"', '"spirit week"',
    "conferences", '"half day"', "in-service", '"teacher workshop"', "newsletter", "classroom", "preschool", "daycare", "kindergarten"];
  const from = senders.length ? `from:(${senders.join(" OR ")}) OR ` : "";
  return `newer_than:30d -category:promotions -category:social (${from}${words.join(" OR ")})`;
}
