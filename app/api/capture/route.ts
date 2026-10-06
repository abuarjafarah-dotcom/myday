import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Capture from anywhere: an iOS Shortcut (voice or text, or the share sheet) posts a brain dump here.
// It lands in "Brain dumps to sort" on the dashboard, where you review it before anything is added.
// Auth: header "Authorization: Bearer <CAPTURE_TOKEN>". Owner: CAPTURE_EMAIL. Both are Vercel env vars.

function authorized(request: Request): boolean {
  const expected = process.env.CAPTURE_TOKEN || "";
  if (expected.length < 24) return false;                       // refuse to run with a weak or missing token
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readText(request: Request): Promise<string> {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    const v = (body && (body.text ?? body.Text ?? body.input)) || "";
    return Array.isArray(v) ? v.join("\n") : String(v);
  }
  if (type.includes("form")) {
    const form = await request.formData().catch(() => null);
    return String(form?.get("text") || "");
  }
  return await request.text();
}

export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
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
