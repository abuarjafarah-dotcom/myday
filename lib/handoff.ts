import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HOUSEHOLD, type Who } from "@/lib/household";

// The evening handoff between Farah and Omar, modeled on an ICU sign-out (I-PASS):
// how the day went, what happened, what's still open, what's coming, and what the other person should do.
// Stored next to the shared household list (owner "_household", kind "handoff", id "<from>-<date>"), so one
// handoff per person per day; sending again the same day replaces it.

export type Section = { key: string; label: string; lines: string[] };
export type Handoff = {
  id: string;
  from: Who;
  to: Who;
  date: string;
  status: "smooth" | "busy" | "rough" | null;   // the "illness severity" of the day
  sections: Section[];
  note: string;
  sentAt: number;
  readAt: number | null;
};

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
const TABLE = "dashboard_docs";
const KIND = "handoff";
const KEEP_DAYS = 14;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const SECTION_KEYS = ["kids", "done", "open", "tomorrow", "foryou"];

const line = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 200);

export async function listHandoffs(db: Db): Promise<Handoff[]> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND);
  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const all = ((data || []) as { data: Handoff }[]).map((r) => r.data).filter((h) => h && h.id);
  const old = all.filter((h) => h.sentAt < cutoff);
  if (old.length) await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).in("id", old.map((h) => h.id));
  return all.filter((h) => h.sentAt >= cutoff).sort((a, b) => b.sentAt - a.sentAt);
}

export async function sendHandoff(db: Db, me: Who, body: Record<string, unknown>): Promise<Handoff> {
  const date = typeof body.date === "string" && DAY.test(body.date) ? body.date : null;
  if (!date) throw new Error("date");
  const raw = Array.isArray(body.sections) ? (body.sections as Record<string, unknown>[]) : [];
  const sections: Section[] = raw
    .filter((s) => s && SECTION_KEYS.includes(String(s.key)))
    .map((s) => ({
      key: String(s.key),
      label: line(s.label).slice(0, 40) || String(s.key),
      lines: (Array.isArray(s.lines) ? s.lines : []).map(line).filter(Boolean).slice(0, 20),
    }));
  const note = String(body.note ?? "").trim().slice(0, 1000);
  if (!sections.some((s) => s.lines.length) && !note) throw new Error("empty");
  const status = body.status === "smooth" || body.status === "busy" || body.status === "rough" ? body.status : null;
  const h: Handoff = { id: `${me}-${date}`, from: me, to: me === "farah" ? "omar" : "farah", date, status, sections, note, sentAt: Date.now(), readAt: null };
  const { error } = await db.from(TABLE).upsert([{ owner: HOUSEHOLD, kind: KIND, id: h.id, data: h, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  if (error) throw new Error(error.message);
  return h;
}

export async function markRead(db: Db, me: Who, id: string): Promise<void> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id).maybeSingle();
  const h = (data?.data as Handoff) || null;
  if (!h || h.to !== me || h.readAt) return;
  await db.from(TABLE).upsert([{ owner: HOUSEHOLD, kind: KIND, id, data: { ...h, readAt: Date.now() }, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
}

// Phone notification when a handoff arrives. The scheduler decides when it may go out (Farah's quiet hours).
export function handoffMessages(me: Who, list: Handoff[], sent: Record<string, number>): { key: string; title: string; body: string }[] {
  const name = me === "farah" ? "Omar" : "Farah";
  const fresh = Date.now() - 36 * 3600000;
  return list
    .filter((h) => h.to === me && !h.readAt && h.sentAt >= fresh && !sent[`ho-${h.id}-${h.sentAt}`])
    .slice(0, 1)
    .map((h) => {
      const key = `ho-${h.id}-${h.sentAt}`;
      sent[key] = Date.now();
      const first = h.sections.flatMap((s) => s.lines).slice(0, 2).join(" · ");
      const mood = h.status === "rough" ? "Rough day. " : h.status === "busy" ? "Busy day. " : "";
      return { key, title: `Handoff from ${name}`, body: `${mood}${first || h.note.slice(0, 120)}`.slice(0, 180) || "Tap to read." };
    });
}
