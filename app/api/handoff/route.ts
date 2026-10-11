import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { whoIs } from "@/lib/household";
import { listHandoffs, markRead, sendHandoff } from "@/lib/handoff";
import { partnerDays } from "@/lib/partner";

export const dynamic = "force-dynamic";

// The evening handoff between Farah and Omar.
//   GET   { me, inbox: latest handoff to me (2 days), mine: my latest (2 days), days: Omar's next 2 day labels (his page only) }
//   POST { op: "send", date, status?, sections: [{ key, label, lines[] }], note? }
//   POST { op: "read", id }
async function context() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const me = whoIs(session.user.email);
  if (!me) return { error: Response.json({ error: "Not available" }, { status: 403 }) };
  const db = supabaseAdmin();
  if (!db) return { error: Response.json({ error: "not_configured" }, { status: 503 }) };
  return { me, db };
}

export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  const recent = Date.now() - 2 * 86400000;
  const [all, own] = await Promise.all([
    listHandoffs(c.db),
    c.me === "omar" ? partnerDays(c.db, 2).catch(() => ({ days: [] })) : Promise.resolve({ days: [] }),
  ]);
  const list = all.filter((h) => h.sentAt >= recent);
  return Response.json(
    { me: c.me, inbox: list.find((h) => h.to === c.me) || null, mine: list.find((h) => h.from === c.me) || null, days: own.days },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(request: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "bad_json" }, { status: 400 });
  try {
    if (body.op === "send") return Response.json({ handoff: await sendHandoff(c.db, c.me, body) });
    if (body.op === "read" && typeof body.id === "string" && /^(farah|omar)-\d{4}-\d{2}-\d{2}$/.test(body.id)) {
      await markRead(c.db, c.me, body.id);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "bad_request" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    if (msg === "empty") return Response.json({ error: "Add at least one line." }, { status: 400 });
    if (msg === "date") return Response.json({ error: "bad_date" }, { status: 400 });
    console.error("handoff", msg);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
