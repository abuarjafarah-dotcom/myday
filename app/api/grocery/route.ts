import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

// Store-arrival alerts. An iPhone Shortcuts automation ("When I arrive at Costco") calls
//   GET /api/grocery?store=costco
// with header "Authorization: Bearer <CAPTURE_TOKEN>" and shows the reply as a notification.
// Returns the open (unchecked, not archived) items for that store from Farah's synced grocery list.
// Store matching ignores case, spaces and punctuation: "traderjoes", "Trader Joe's" and "trader-joes" all work.
// Add &format=text to get a plain-text reply instead of JSON.

function tokenMatches(given: string, expected: string): boolean {
  if (expected.length < 24) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Item = { item?: string; store?: string; checked?: boolean; archived?: boolean; quantity?: string | number | null; createdAt?: number };

export async function GET(request: Request) {
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!tokenMatches(given, process.env.CAPTURE_TOKEN || "")) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const owner = (process.env.CAPTURE_EMAIL || "").trim().toLowerCase();
  if (!owner) return Response.json({ error: "CAPTURE_EMAIL is not set" }, { status: 503 });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "Sync is not set up" }, { status: 503 });

  const url = new URL(request.url);
  const wanted = norm(url.searchParams.get("store") || "");
  if (!wanted) return Response.json({ error: "Add ?store=costco (or target, traderjoes)" }, { status: 400 });

  const { data, error } = await db.from("dashboard_docs").select("data").eq("owner", owner).eq("kind", "grocery");
  if (error) {
    console.error("grocery read", error);
    return Response.json({ error: "Couldn't read the list. Try again." }, { status: 500 });
  }

  const all = (data || []).map((r) => r.data as Item).filter((g) => g && !g.archived && g.item && g.store);
  const open = all
    .filter((g) => !g.checked && norm(g.store!) === wanted)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const storeName = open[0]?.store || all.find((g) => norm(g.store!) === wanted)?.store || url.searchParams.get("store")!;

  const items = open.map((g) => (g.quantity ? `${g.item} (${g.quantity})` : g.item!));
  const title = items.length ? `At ${storeName}: ${items.length} to get` : `Nothing on your ${storeName} list`;
  const text = items.join(", ");
  const link = `${url.origin}/dashboard?tab=grocery&store=${encodeURIComponent(storeName)}`;

  if (url.searchParams.get("format") === "text") {
    return new Response(items.length ? `${title}\n${text}` : "", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return Response.json({ store: storeName, count: items.length, title, text, items, link });
}
