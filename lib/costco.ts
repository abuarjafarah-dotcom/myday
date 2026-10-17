import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HOUSEHOLD, type Who } from "@/lib/household";

// The shared Costco list, seen by Farah and Omar. Every open Costco item counts, however it got there:
//   - items Omar adds here            -> stored in the household store (owner _household, kind "costco"), ids "c-…"
//   - Farah's Costco grocery items    -> her own grocery list (kind "grocery"), ids "g-…". Shared automatically:
//     they're read into this view, and checking or removing them here updates her grocery row.
// So nothing has to be "sent" to share it. Checked items stay visible for a week, like the household list.

export type CostcoItem = {
  id: string;
  item: string;
  by: Who;
  checked: boolean;
  checkedBy: Who | null;
  checkedAt: number | null;
  createdAt: number;
  source: "shared" | "grocery";
};

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
const TABLE = "dashboard_docs";
const KIND = "costco";
const KEEP_CHECKED_DAYS = 7;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanItem = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
const farahEmail = () => (process.env.CAPTURE_EMAIL || "").trim().toLowerCase();

// Shared-list rows only (used by the grocery alert, which reads Farah's grocery rows separately).
export async function listCostco(db: Db): Promise<CostcoItem[]> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND);
  const cutoff = Date.now() - KEEP_CHECKED_DAYS * 86400000;
  return ((data || []) as { data: Omit<CostcoItem, "source"> }[])
    .map((r) => ({ ...r.data, source: "shared" as const }))
    .filter((c) => c && c.id && c.item && (!c.checked || (c.checkedAt || 0) >= cutoff))
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Open Costco items from Farah's own grocery list.
async function openGroceryCostco(db: Db): Promise<CostcoItem[]> {
  const owner = farahEmail();
  if (!owner) return [];
  const { data } = await db.from(TABLE).select("data").eq("owner", owner).eq("kind", "grocery");
  return ((data || []) as { data: { id?: string; item?: string; store?: string; checked?: boolean; archived?: boolean; createdAt?: number } }[])
    .map((r) => r.data)
    .filter((g) => g && g.id && g.item && g.store && norm(g.store) === "costco" && !g.checked && !g.archived)
    .map((g) => ({
      id: g.id!, item: g.item!, by: "farah" as Who, checked: false, checkedBy: null, checkedAt: null,
      createdAt: g.createdAt || 0, source: "grocery" as const,
    }));
}

// What both of them see: open shared items plus Farah's open Costco items, one line per item name.
export async function costcoView(db: Db): Promise<CostcoItem[]> {
  const [shared, grocery] = await Promise.all([listCostco(db), openGroceryCostco(db)]);
  const seen = new Set(shared.filter((c) => !c.checked).map((c) => norm(c.item)));
  const extra = grocery.filter((g) => !seen.has(norm(g.item)));
  return [...shared, ...extra].sort((a, b) => a.createdAt - b.createdAt);
}

async function save(db: Db, c: Omit<CostcoItem, "source">): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .upsert([{ owner: HOUSEHOLD, kind: KIND, id: c.id, data: c, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  if (error) throw new Error(error.message);
}

// Adding something already open (in either list) returns the existing line, so nothing doubles up.
export async function addCostco(db: Db, me: Who, rawItem: unknown): Promise<CostcoItem> {
  const item = cleanItem(rawItem);
  if (!item) throw new Error("item");
  const existing = (await costcoView(db)).find((c) => norm(c.item) === norm(item));
  if (existing) return existing;
  const now = Date.now();
  const c = {
    id: `c-${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    item, by: me, checked: false, checkedBy: null, checkedAt: null, createdAt: now,
  };
  await save(db, c);
  return { ...c, source: "shared" };
}

async function updateGroceryRow(db: Db, id: string, patch: Record<string, unknown>): Promise<boolean> {
  const owner = farahEmail();
  if (!owner) return false;
  const { data } = await db.from(TABLE).select("data").eq("owner", owner).eq("kind", "grocery").eq("id", id).maybeSingle();
  const cur = data?.data as Record<string, unknown> | undefined;
  if (!cur) return false;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  const { error } = await db
    .from(TABLE)
    .upsert([{ owner, kind: "grocery", id, data: next, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  if (error) throw new Error(error.message);
  return true;
}

export async function setCostcoChecked(db: Db, me: Who, id: string, checked: boolean): Promise<CostcoItem | null> {
  if (id.startsWith("g-")) {
    const at = checked ? Date.now() : null;
    const ok = await updateGroceryRow(db, id, { checked, checkedAt: at });
    if (!ok) return null;
    const g = (await openGroceryCostco(db)).find((x) => x.id === id);
    return g || { id, item: "", by: "farah", checked, checkedBy: checked ? me : null, checkedAt: at, createdAt: 0, source: "grocery" };
  }
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id).maybeSingle();
  const cur = (data?.data as Omit<CostcoItem, "source">) || null;
  if (!cur) return null;
  const next = { ...cur, checked, checkedBy: checked ? me : null, checkedAt: checked ? Date.now() : null };
  await save(db, next);
  return { ...next, source: "shared" };
}

export async function removeCostco(db: Db, id: string): Promise<void> {
  if (id.startsWith("g-")) {
    await updateGroceryRow(db, id, { archived: true, archivedAt: Date.now() });
    return;
  }
  await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id);
}

export async function clearCheckedCostco(db: Db): Promise<void> {
  const checked = (await listCostco(db)).filter((c) => c.checked);
  if (!checked.length) return;
  await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).in("id", checked.map((c) => c.id));
}
