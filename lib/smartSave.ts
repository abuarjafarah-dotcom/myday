import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { humanWhen, localToday, parseCapture, type Parsed } from "@/lib/smart";

// Parses a capture and saves each item straight onto that person's dashboard (tasks, trips, notes).
// Used by the voice shortcut (/api/capture with Omar's token) and the "Smart add" box on /omar.

const TABLE = "dashboard_docs";
const LABEL: Record<string, string> = { paper: "Paper", slides: "PowerPoint", email: "Email", meeting: "Meeting", other: "Other" };

export type Saved = {
  items: (Parsed & { id: string })[];
  reminders: { title: string; date: string; when: string }[];
  message: string;
};

const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function fmtShort(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export async function smartSave(owner: string, text: string, opts: { tz?: string; source: string; reminderTime?: string }): Promise<Saved | { error: string; status: number }> {
  const db = supabaseAdmin();
  if (!db) return { error: "Sync is not set up", status: 503 };
  const today = localToday(opts.tz || "America/Chicago");
  const parsed = parseCapture(text, today);
  if (!parsed.length) return { error: "I couldn't find anything to add.", status: 400 };

  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const rows: { owner: string; kind: string; id: string; data: Record<string, unknown>; updated_at: string }[] = [];
  const items: Saved["items"] = [];
  for (const p of parsed) {
    if (p.kind === "trip") {
      const id = newId("trip");
      rows.push({
        owner, kind: "trips", id, updated_at: stamp,
        data: { id, destination: p.destination, start: p.start || null, end: p.end || p.start || null, remindOn: p.remindOn, said: p.text, source: opts.source, createdAt: now, updatedAt: now },
      });
      items.push({ ...p, id });
    } else if (p.kind === "note") {
      const id = newId("n");
      rows.push({ owner, kind: "notes", id, updated_at: stamp, data: { id, text: p.title, source: opts.source, createdAt: now, updatedAt: now } });
      items.push({ ...p, id });
    } else {
      const id = newId("t");
      rows.push({
        owner, kind: "tasks", id, updated_at: stamp,
        data: { id, title: p.title, category: p.category, priority: p.priority, due: p.due, time: p.time, remindOn: p.remindOn, status: "todo", notes: "", said: p.text, source: opts.source, createdAt: now, updatedAt: now },
      });
      items.push({ ...p, id });
    }
  }
  const { error } = await db.from(TABLE).upsert(rows, { onConflict: "owner,kind,id" });
  if (error) {
    console.error("smart save", error.message);
    return { error: "Couldn't save. Try again.", status: 500 };
  }

  const time = opts.reminderTime || "8:00 AM";
  const reminders = items
    .filter((i) => i.remindOn)
    .map((i) => ({ title: i.title, date: i.remindOn as string, when: humanWhen(i.remindOn as string, time) }));

  // A short sentence the Shortcut can show or speak.
  const parts = items.map((i) => {
    if (i.kind === "trip") return `${i.title}${i.start ? ` ${fmtShort(i.start)}${i.end && i.end !== i.start ? `–${fmtShort(i.end)}` : ""}` : ""}`;
    if (i.kind === "note") return `Note saved`;
    return `${i.title} (P${i.priority} ${LABEL[i.category] || "Other"}${i.due ? `, due ${fmtShort(i.due)}` : ""})`;
  });
  const remind = reminders.length ? ` Reminder${reminders.length > 1 ? "s" : ""}: ${reminders.map((r) => fmtShort(r.date)).join(", ")}.` : "";
  const moved = items.some((i) => i.remindAdjusted) ? " One reminder date had passed, so it's set for today." : "";
  return { items, reminders, message: `Added: ${parts.join("; ")}.${remind}${moved}` };
}
