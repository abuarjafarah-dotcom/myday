import { categorize, parseCapture, type Category } from "@/lib/smart";

// Free, rule-based task finder for Omar's personal Gmail. Suggests; nothing is saved until he taps Add.
// Each suggestion carries a type (Paper, PowerPoint, Email, Meeting, Other), a priority and a due date.

export type MailDoc = { id: string; subject: string; from: string; body: string };
export type OmarSuggestion = {
  mailId: string; subject: string; from: string;
  title: string; due: string | null; time: string | null;
  category: Category; priority: 1 | 2 | 3; why: string;
};

const ACTION = /\b(please|kindly|could you|can you|would you|need(?:s|ed)? (?:you|your)|deadline|due|submit|submission|review|revise|revision|resubmit|sign|complete|confirm|rsvp|register|reply|respond|let (?:me|us) know|send|share|prepare|present|slides?|deck|power ?point|manuscript|abstract|draft|meeting|call|schedule|reschedule|availability|available)\b/i;
const FOOTER = /unsubscribe|view (this )?(email )?in (your )?browser|privacy policy|all rights reserved|manage (your )?preferences|sent from my|^on .+ wrote:$/i;
const NO_REPLY = /no-?reply|do-?not-?reply|notifications?@|mailer|newsletter|digest|marketing|billing@|receipts?@/i;
const QUESTION = /\?\s*$/;

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function omarExtract(mails: MailDoc[], today: string): OmarSuggestion[] {
  const out: OmarSuggestion[] = [];
  for (const m of mails) {
    if (NO_REPLY.test(m.from)) continue;
    const lines = m.body
      .split(/\n|(?<=[.!?])\s+/)
      .map((x) => x.trim().replace(/^[-*•\d.)\s]+/, ""))
      .filter((x) => x.length >= 12 && x.length <= 220 && !FOOTER.test(x));
    const action = lines.filter((x) => ACTION.test(x)).slice(0, 2);
    const asked = lines.some((x) => QUESTION.test(x));
    const subjectCat = categorize(m.subject);

    for (const line of action) {
      const p = parseCapture(line, today)[0];
      if (!p || p.kind !== "task") continue;
      const cat = p.category !== "other" ? p.category : subjectCat !== "other" ? subjectCat : "email";
      const due = p.due || parseCapture(m.subject, today)[0]?.due || null;
      out.push({
        mailId: m.id, subject: m.subject, from: m.from,
        title: clip(sentenceCase(p.title || line), 100),
        due, time: p.time,
        category: cat,
        priority: p.priority !== 2 ? p.priority : due && due <= addDays(today, 3) ? 1 : 2,
        why: clip(`${m.from}: ${m.subject}`, 90),
      });
    }
    // A real person asked a question and nothing above caught it: suggest a reply.
    if (!action.length && asked) {
      out.push({
        mailId: m.id, subject: m.subject, from: m.from,
        title: clip(`Reply to ${m.from.split(/[<@]/)[0].trim() || "email"}: ${m.subject}`, 100),
        due: null, time: null, category: "email", priority: 2,
        why: clip(`${m.from}: ${m.subject}`, 90),
      });
    }
    if (out.length >= 15) break;
  }
  return out.slice(0, 15);
}

function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
