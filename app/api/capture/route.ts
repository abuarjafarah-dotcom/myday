import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { omarEmail } from "@/lib/users";
import { smartSave } from "@/lib/smartSave";

export const dynamic = "force-dynamic";

// Capture from anywhere: an iOS Shortcut (voice or text, or the share sheet) posts a brain dump here.
// It lands in "Brain dumps to sort" on the dashboard, where you review it before anything is added.
// Auth: header "Authorization: Bearer <CAPTURE_TOKEN>". Owner: CAPTURE_EMAIL. Both are Vercel env vars.
// Omar's shortcut uses CAPTURE_TOKEN_OMAR instead. His entries skip the review queue: the smart filter files
// them straight onto /omar as tasks, trips or notes, and the reply lists any reminders for his iPhone.

function tokenMatches(given: string, expected: string): boolean {
  if (expected.length < 24) return false;                       // refuse to run with a weak or missing token
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function whoIsCapturing(request: Request): "farah" | "omar" | null {
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (tokenMatches(given, process.env.CAPTURE_TOKEN || "")) return "farah";
  if (tokenMatches(given, process.env.CAPTURE_TOKEN_OMAR || "")) return "omar";
  return null;
}

async function readBody(request: Request): Promise<{ text: string; tz: string }> {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    const v = (body && (body.text ?? body.Text ?? body.input)) || "";
    return { text: Array.isArray(v) ? v.join("\n") : String(v), tz: String((body && body.tz) || "") };
  }
  if (type.includes("form")) {
    const form = await request.formData().catch(() => null);
    return { text: String(form?.get("text") || ""), tz: String(form?.get("tz") || "") };
  }
  return { text: await request.text(), tz: "" };
}

async function readText(request: Request): Promise<string> {
  return (await readBody(request)).text;
}

export async function POST(request: Request) {
  const who = whoIsCapturing(request);
  if (!who) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (who === "omar") return captureForOmar(request);
  const owner = (process.env.CAPTURE_EMAIL || "").trim().toLowerCase();
  if (!owner) return Response.json({ error: "CAPTURE_EMAIL is not set" }, { status: 503 });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "Sync is not set up" }, { status: 503 });

  const text = (await readText(request)).replace(/\r\n/g, "\n").trim().slice(0, 5000);
  if (!text) return Response.json({ error: "Nothing to save. Send some text." }, { status: 400 });

  const now = Date.now();
  const id = `d-${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const data = { id, text, createdAt: now, processed: false, source: "shortcut", updatedAt: now };
  const { error } = await db
    .from("dashboard_docs")
    .upsert([{ owner, kind: "dumps", id, data, updated_at: new Date(now).toISOString() }], { onConflict: "owner,kind,id" });
  if (error) {
    console.error("capture write", error);
    return Response.json({ error: "Couldn't save. Try again." }, { status: 500 });
  }
  return Response.json({ ok: true, message: "Saved to your dashboard" });
}

async function captureForOmar(request: Request): Promise<Response> {
  const owner = omarEmail();
  if (!owner) return Response.json({ error: "OMAR_EMAIL is not set" }, { status: 503 });
  const { text: raw, tz } = await readBody(request);
  const text = raw.replace(/\r\n/g, "\n").trim().slice(0, 5000);
  if (!text) return Response.json({ error: "Nothing to save. Say or type something." }, { status: 400 });
  const result = await smartSave(owner, text, {
    tz: tz || process.env.CALENDAR_TIMEZONE || "America/Chicago",
    source: "shortcut",
    reminderTime: process.env.OMAR_REMINDER_TIME || "8:00 AM",
  });
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  const first = result.reminders[0];
  return Response.json({
    ok: true,
    message: result.message,
    items: result.items.map(({ text: _said, ...i }) => { void _said; return i; }),
    reminders: result.reminders,
    // Flat copies of the first reminder, so a simple Shortcut can use them without a loop.
    hasReminder: first ? "yes" : "no",
    reminderTitle: first ? first.title : "",
    reminderWhen: first ? first.when : "",
  });
}
