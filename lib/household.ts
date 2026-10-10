import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFarah } from "@/lib/partner";
import { omarEmail } from "@/lib/users";

// Shared household tasks: one list Farah and Omar both see and edit. Stored in the same table under a
// neutral owner, so neither person's own store (and its sync) is touched. Only the two of them can reach it.

export type Who = "farah" | "omar";
export type To = Who | "either";
export type Shared = {
  id: string;
  title: string;
  to: To;
  by: Who;
  date: string | null;     // the day it's planned for
  due: string | null;
  note: string;
  status: "todo" | "done";
  doneBy: Who | null;
  doneAt: number | null;
  createdAt: number;
  updatedAt: number;
};

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
export const HOUSEHOLD = "_household";
const TABLE = "dashboard_docs";
const KIND = "shared";
const KEEP_DONE_DAYS = 14;

export function whoIs(email: string | null | undefined): Who | null {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  if (isFarah(e)) return "farah";
  if (omarEmail() && e === omarEmail()) return "omar";
  return null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cleanDay = (v: unknown) => (typeof v === "string" && DAY.test(v) ? v : null);
const cleanTo = (v: unknown): To => (v === "farah" || v === "omar" || v === "either" ? v : "either");
const cleanTitle = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 160);

export async function listShared(db: Db): Promise<Shared[]> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND);
  const cutoff = Date.now() - KEEP_DONE_DAYS * 86400000;
  return ((data || []) as { data: Shared }[])
    .map((r) => r.data)
    .filter((t) => t && t.id && (t.status !== "done" || (t.doneAt || 0) >= cutoff))
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function save(db: Db, t: Shared): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .upsert([{ owner: HOUSEHOLD, kind: KIND, id: t.id, data: t, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  if (error) throw new Error(error.message);
}

export async function addShared(db: Db, me: Who, body: Record<string, unknown>): Promise<Shared> {
  const title = cleanTitle(body.title);
  if (!title) throw new Error("title");
  const now = Date.now();
  const t: Shared = {
    id: `h-${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    title, to: cleanTo(body.to), by: me, date: cleanDay(body.date), due: cleanDay(body.due),
    note: String(body.note ?? "").slice(0, 500), status: "todo", doneBy: null, doneAt: null, createdAt: now, updatedAt: now,
  };
  await save(db, t);
  return t;
}

export async function updateShared(db: Db, me: Who, id: string, patch: Record<string, unknown>): Promise<Shared | null> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id).maybeSingle();
  const cur = (data?.data as Shared) || null;
  if (!cur) return null;
  const next: Shared = { ...cur, updatedAt: Date.now() };
  if ("title" in patch) { const t = cleanTitle(patch.title); if (t) next.title = t; }
  if ("to" in patch) next.to = cleanTo(patch.to);
  if ("date" in patch) next.date = cleanDay(patch.date);
  if ("due" in patch) next.due = cleanDay(patch.due);
  if ("note" in patch) next.note = String(patch.note ?? "").slice(0, 500);
  if (patch.status === "done" && cur.status !== "done") { next.status = "done"; next.doneBy = me; next.doneAt = Date.now(); }
  if (patch.status === "todo") { next.status = "todo"; next.doneBy = null; next.doneAt = null; }
  await save(db, next);
  return next;
}

export async function deleteShared(db: Db, id: string): Promise<void> {
  await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id);
}

// Phone notifications for the reminder scheduler: what the other person added for you, and what they finished
// that you asked for. Only recent changes, so turning this on never replays old history.
export function householdMessages(me: Who, items: Shared[], sent: Record<string, number>): { key: string; title: string; body: string }[] {
  const other: Who = me === "farah" ? "omar" : "farah";
  const name = other === "farah" ? "Farah" : "Omar";
  const recent = Date.now() - 2 * 86400000;
  const out: { key: string; title: string; body: string }[] = [];
  const added = items.filter((t) => t.by === other && t.status === "todo" && (t.to === me || t.to === "either") && t.createdAt >= recent && !sent[`hh-new-${t.id}`]);
  if (added.length) {
    added.forEach((t) => (sent[`hh-new-${t.id}`] = Date.now()));
    const first = added[0];
    out.push({
      key: `hh-new-${first.id}`,
      title: added.length === 1 ? `${name} added a household task` : `${name} added ${added.length} household tasks`,
      body: added.map((t) => t.title + (t.to === "either" ? " (either of you)" : "")).slice(0, 3).join(", ") + (added.length > 3 ? ` +${added.length - 3} more` : ""),
    });
  }
  const done = items.filter((t) => t.status === "done" && t.by === me && t.doneBy === other && (t.doneAt || 0) >= recent && !sent[`hh-done-${t.id}`]);
  if (done.length) {
    done.forEach((t) => (sent[`hh-done-${t.id}`] = Date.now()));
    out.push({ key: `hh-done-${done[0].id}`, title: `${name} finished ${done.length === 1 ? "a task" : done.length + " tasks"} ✓`, body: done.map((t) => t.title).slice(0, 3).join(", ") });
  }
  return out;
}
