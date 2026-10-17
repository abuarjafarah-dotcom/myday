import { timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { listCostco } from "@/lib/costco";
import { omarEmail } from "@/lib/users";

export const dynamic = "force-dynamic";

// Store-arrival alerts. An iPhone Shortcuts automation ("When I arrive at Costco") calls
//   GET /api/grocery?store=costco&format=text
// with header "Authorization: Bearer <token>" and shows the reply as a notification.
//   Farah's token  (CAPTURE_TOKEN)       -> her own list for the store
//   Omar's token   (CAPTURE_TOKEN_OMAR)  -> his list for the store (Costco also includes what's shared)
// For Costco, the shared list (see /api/household?view=costco) is included for both of them, so the
// same alert covers the trip whoever is at the store. Only unchecked items are returned.
// Store matching ignores case, spaces and punctuation: "traderjoes", "Trader Joe's" and "trader-joes" all work.

function tokenMatches(given: string, expected: string): boolean {
  if (expected.length < 24) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

type Item = { item?: string; store?: string; checked?: boolean; archived?: boolean; quantity?: string | number | null; createdAt?: number };

export async function GET(request: Request) {
  const given = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const who = tokenMatches(given, process.env.CAPTURE_TOKEN || "") ? "farah"
    : tokenMatches(given, process.env.CAPTURE_TOKEN_OMAR || "") ? "omar" : null;
  if (!who) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const owner = (who === "omar" ? omarEmail() : (process.env.CAPTURE_EMAIL || "").trim().toLowerCase());
  if (!owner) return Response.json({ error: who === "omar" ? "OMAR_EMAIL is not set" : "CAPTURE_EMAIL is not set" }, { status: 503 });
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
  const own = all
    .filter((g) => !g.checked && norm(g.store!) === wanted)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const storeName = own[0]?.store || all.find((g) => norm(g.store!) === wanted)?.store || (wanted === "costco" ? "Costco" : url.searchParams.get("store")!);

  // Shared list: only for Costco, and only the lines not yet checked off.
  const shared = wanted === "costco" ? (await listCostco(db)).filter((c) => !c.checked).map((c) => c.item) : [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const g of own) {
    const label = g.quantity ? `${g.item} (${g.quantity})` : g.item!;
    seen.add(norm(g.item!));
    items.push(label);
  }
  for (const s of shared) if (!seen.has(norm(s))) { seen.add(norm(s)); items.push(s); }

  const title = items.length ? `At ${storeName}: ${items.length} to get` : `Nothing on your ${storeName} list`;
  const text = items.join(", ");
  const link = who === "omar" ? `${url.origin}/omar` : `${url.origin}/dashboard?tab=grocery&store=${encodeURIComponent(storeName)}`;

  if (url.searchParams.get("format") === "text") {
    return new Response(items.length ? `${title}\n${text}` : "", { headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  return Response.json({ store: storeName, count: items.length, title, text, items, link });
}
