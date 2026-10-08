import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { viewFor } from "@/lib/users";

export const dynamic = "force-dynamic";

const KINDS = new Set(["tasks", "projects", "grocery", "notes", "dumps", "meta", "trips"]);
const TABLE = "dashboard_docs";

async function owner() {
  const session = await getServerSession(authOptions);
  return session?.user?.email?.toLowerCase() || null;
}

// Omar's data only syncs from his own page. If he opens Farah's /dashboard on a shared device, that page would
// otherwise upload whatever it has cached into his account, so it gets "wrong page" instead.
function wrongPage(request: Request, email: string): boolean {
  if (viewFor(email) !== "omar") return false;
  try {
    const path = new URL(request.headers.get("referer") || "").pathname;
    return path === "/dashboard" || path.startsWith("/dashboard.");
  } catch {
    return false;
  }
}

export async function GET(request: Request) {
  const email = await owner();
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (wrongPage(request, email)) return Response.json({ error: "wrong_page", home: "/omar" }, { status: 409 });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "not_configured" }, { status: 503 });

  const docs: Record<string, Record<string, unknown>> = {};
  KINDS.forEach((k) => (docs[k] = {}));
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from(TABLE)
      .select("kind,id,data")
      .eq("owner", email)
      .range(from, from + page - 1);
    if (error) {
      console.error("store read", error);
      return Response.json({ error: "read_failed" }, { status: 500 });
    }
    (data || []).forEach((row) => {
      if (KINDS.has(row.kind)) docs[row.kind][row.id] = row.data;
    });
    if (!data || data.length < page) break;
  }
  return Response.json({ docs });
}

type Write = { kind: string; id: string; data: Record<string, unknown> | null };

export async function POST(request: Request) {
  const email = await owner();
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (wrongPage(request, email)) return Response.json({ error: "wrong_page", home: "/omar" }, { status: 409 });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "not_configured" }, { status: 503 });

  let body: { writes?: Write[] };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "bad_json" }, { status: 400 });
  }
  const writes = (body.writes || []).filter(
    (w) => w && KINDS.has(w.kind) && typeof w.id === "string" && w.id.length > 0 && w.id.length <= 200
  );
  if (writes.length > 500) return Response.json({ error: "too_many" }, { status: 400 });

  const upserts = writes
    .filter((w) => w.data && typeof w.data === "object")
    .map((w) => ({ owner: email, kind: w.kind, id: w.id, data: w.data, updated_at: new Date().toISOString() }));
  const deletes = writes.filter((w) => w.data === null);

  if (upserts.length) {
    const { error } = await db.from(TABLE).upsert(upserts, { onConflict: "owner,kind,id" });
    if (error) {
      console.error("store write", error);
      return Response.json({ error: "write_failed" }, { status: 500 });
    }
  }
  for (const d of deletes) {
    const { error } = await db.from(TABLE).delete().eq("owner", email).eq("kind", d.kind).eq("id", d.id);
    if (error) {
      console.error("store delete", error);
      return Response.json({ error: "write_failed" }, { status: 500 });
    }
  }
  return Response.json({ ok: true, saved: upserts.length, deleted: deletes.length });
}
