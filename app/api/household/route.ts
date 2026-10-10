import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { addShared, deleteShared, listShared, updateShared, whoIs } from "@/lib/household";

export const dynamic = "force-dynamic";

// Shared household tasks for Farah and Omar.
//   GET                                   { me, items }
//   POST { op: "add", title, to, date?, due?, note? }
//   POST { op: "update", id, patch: { status?, title?, to?, date?, due?, note? } }
//   POST { op: "delete", id }
async function context() {
  const session = await getServerSession(authOptions);
  const me = whoIs(session?.user?.email);
  if (!session?.user?.email) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!me) return { error: Response.json({ error: "Not available" }, { status: 403 }) };
  const db = supabaseAdmin();
  if (!db) return { error: Response.json({ error: "not_configured" }, { status: 503 }) };
  return { me, db };
}

export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  return Response.json({ me: c.me, items: await listShared(c.db) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "bad_json" }, { status: 400 });
  const id = typeof body.id === "string" && /^h-[a-z0-9]{4,40}$/.test(body.id) ? body.id : null;
  try {
    if (body.op === "add") return Response.json({ item: await addShared(c.db, c.me, body) });
    if (body.op === "update" && id) {
      const item = await updateShared(c.db, c.me, id, (body.patch as Record<string, unknown>) || {});
      return item ? Response.json({ item }) : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (body.op === "delete" && id) { await deleteShared(c.db, id); return Response.json({ ok: true }); }
    return Response.json({ error: "bad_request" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    if (msg === "title") return Response.json({ error: "Add a title." }, { status: 400 });
    console.error("household", msg);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
