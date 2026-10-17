import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { addShared, deleteShared, listShared, updateShared, whoIs } from "@/lib/household";
import { sendWeek, weekForOmar, weekShare } from "@/lib/weekShare";
import { addCostco, clearCheckedCostco, listCostco, removeCostco, setCostcoChecked } from "@/lib/costco";

export const dynamic = "force-dynamic";

// Shared household tasks for Farah and Omar.
//   GET                                   { me, items }
//   GET ?view=week                        "This week at home": Farah gets the live view; Omar only the snapshot she sent
//   POST { op: "week-send" }              Farah sends this week's snapshot to Omar
//   POST { op: "add", title, to, date?, due?, note? }
//   POST { op: "update", id, patch: { status?, title?, to?, date?, due?, note? } }
//   POST { op: "delete", id }
//   GET ?view=costco                      the shared Costco list (both of them)
//   POST { op: "costco-add", item }       also used to send one of Farah's Costco items to Omar
//   POST { op: "costco-check", id, checked }
//   POST { op: "costco-del", id }
//   POST { op: "costco-clear" }           remove everything already checked off
async function context() {
  const session = await getServerSession(authOptions);
  const me = whoIs(session?.user?.email);
  if (!session?.user?.email) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!me) return { error: Response.json({ error: "Not available" }, { status: 403 }) };
  const db = supabaseAdmin();
  if (!db) return { error: Response.json({ error: "not_configured" }, { status: 503 }) };
  return { me, db };
}

export async function GET(request: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const view = new URL(request.url).searchParams.get("view");
  if (view === "costco") return Response.json({ me: c.me, items: await listCostco(c.db) }, { headers: { "Cache-Control": "no-store" } });
  if (view === "week") {
    const week = await (c.me === "omar" ? weekForOmar(c.db) : weekShare(c.db)).catch(() => null);
    return Response.json({ me: c.me, week }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ me: c.me, items: await listShared(c.db) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "bad_json" }, { status: 400 });
  const id = typeof body.id === "string" && /^[hc]-[a-z0-9]{4,40}$/.test(body.id) ? body.id : null;
  try {
    if (body.op === "week-send") {
      if (c.me !== "farah") return Response.json({ error: "Not available" }, { status: 403 });
      return Response.json({ week: await sendWeek(c.db) });
    }
    if (body.op === "add") return Response.json({ item: await addShared(c.db, c.me, body) });
    if (body.op === "update" && id) {
      const item = await updateShared(c.db, c.me, id, (body.patch as Record<string, unknown>) || {});
      return item ? Response.json({ item }) : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (body.op === "delete" && id) { await deleteShared(c.db, id); return Response.json({ ok: true }); }
    if (body.op === "costco-add") return Response.json({ item: await addCostco(c.db, c.me, body.item) });
    if (body.op === "costco-check" && id) {
      const item = await setCostcoChecked(c.db, c.me, id, body.checked !== false);
      return item ? Response.json({ item }) : Response.json({ error: "not_found" }, { status: 404 });
    }
    if (body.op === "costco-del" && id) { await removeCostco(c.db, id); return Response.json({ ok: true }); }
    if (body.op === "costco-clear") { await clearCheckedCostco(c.db); return Response.json({ ok: true }); }
    return Response.json({ error: "bad_request" }, { status: 400 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "failed";
    if (msg === "title") return Response.json({ error: "Add a title." }, { status: 400 });
    if (msg === "item") return Response.json({ error: "Add an item." }, { status: 400 });
    console.error("household", msg);
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
