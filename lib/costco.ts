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

// The same item can sit on both lists (added on the shared list and also on Farah's grocery list). The view
// shows one line for it, so checking or removing only one copy brings the other back on the next refresh.
// So a check or remove applies to every copy of that item name, on both lists.

const sameItem = (a: unknown, b: string) => norm(String(a ?? "")) === norm(b);

// Farah's Costco grocery rows with this name, not archived.
async function groceryCopies(db: Db, name: string): Promise<{ id: string; cur: Record<string, unknown> }[]> {
  const owner = farahEmail();
  if (!owner) return [];
  const { data } = await db.from(TABLE).select("id,data").eq("owner", owner).eq("kind", "grocery");
  return ((data || []) as { id: string; data: Record<string, unknown> }[])
    .filter((r) => {
      const g = r.data as { item?: string; store?: string; archived?: boolean } | null;
      return !!g && !g.archived && !!g.item && !!g.store && norm(g.store) === "costco" && sameItem(g.item, name);
    })
    .map((r) => ({ id: r.id, cur: r.data }));
}

async function patchGroceryRows(db: Db, rows: { id: string; cur: Record<string, unknown> }[], patch: Record<string, unknown>): Promise<void> {
  const owner = farahEmail();
  if (!owner || !rows.length) return;
  const now = Date.now();
  const { error } = await db
    .from(TABLE)
    .upsert(
      rows.map((r) => ({ owner, kind: "grocery", id: r.id, data: { ...r.cur, ...patch, updatedAt: now }, updated_at: new Date(now).toISOString() })),
      { onConflict: "owner,kind,id" }
    );
  if (error) throw new Error(error.message);
}

// Shared Costco rows with this name.
async function sharedCopies(db: Db, name: string): Promise<Omit<CostcoItem, "source">[]> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND);
  return ((data || []) as { data: Omit<CostcoItem, "source"> }[])
    .map((r) => r.data)
    .filter((c) => !!c && !!c.id && !!c.item && sameItem(c.item, name));
}

async function saveSharedRows(db: Db, rows: Omit<CostcoItem, "source">[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await db
    .from(TABLE)
    .upsert(rows.map((c) => ({ owner: HOUSEHOLD, kind: KIND, id: c.id, data: c, updated_at: new Date().toISOString() })), { onConflict: "owner,kind,id" });
  if (error) throw new Error(error.message);
}

// The item text behind a row id, from whichever list holds it.
async function itemNameOf(db: Db, id: string): Promise<string | null> {
  if (id.startsWith("g-")) {
    const owner = farahEmail();
    if (!owner) return null;
    const { data } = await db.from(TABLE).select("data").eq("owner", owner).eq("kind", "grocery").eq("id", id).maybeSingle();
    return (data?.data as { item?: string } | null)?.item || null;
  }
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id).maybeSingle();
  return (data?.data as { item?: string } | null)?.item || null;
}

export async function setCostcoChecked(db: Db, me: Who, id: string, checked: boolean): Promise<CostcoItem | null> {
  const name = await itemNameOf(db, id);
  if (!name) return null;
  const at = checked ? Date.now() : null;
  const by = checked ? me : null;

  if (checked) {
    // Checking marks every open copy of the item, on both lists.
    const groceryOpen = (await groceryCopies(db, name)).filter((r) => !r.cur.checked);
    await patchGroceryRows(db, groceryOpen, { checked: true, checkedAt: at });
    const sharedOpen = (await sharedCopies(db, name))
      .filter((c) => !c.checked)
      .map((c) => ({ ...c, checked: true, checkedBy: by, checkedAt: at }));
    await saveSharedRows(db, sharedOpen);
  } else {
    // Unchecking only reopens the line that was tapped.
    if (id.startsWith("g-")) {
      const rows = (await groceryCopies(db, name)).filter((r) => r.id === id);
      await patchGroceryRows(db, rows, { checked: false, checkedAt: null });
    } else {
      const cur = (await sharedCopies(db, name)).find((c) => c.id === id);
      if (cur) await saveSharedRows(db, [{ ...cur, checked: false, checkedBy: null, checkedAt: null }]);
    }
  }

  return { id, item: name, by: "farah", checked, checkedBy: by, checkedAt: at, createdAt: 0, source: id.startsWith("g-") ? "grocery" : "shared" };
}

export async function removeCostco(db: Db, id: string): Promise<void> {
  const name = await itemNameOf(db, id);
  if (!name) return;
  // Removing a line removes its open copies on both lists (checked history is left as it is).
  const groceryOpen = (await groceryCopies(db, name)).filter((r) => !r.cur.checked || r.id === id);
  await patchGroceryRows(db, groceryOpen, { archived: true, archivedAt: Date.now() });
  const sharedGone = (await sharedCopies(db, name)).filter((c) => !c.checked || c.id === id).map((c) => c.id);
  if (sharedGone.length) {
    const { error } = await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).in("id", sharedGone);
    if (error) throw new Error(error.message);
  }
}

export async function clearCheckedCostco(db: Db): Promise<void> {
  const checked = (await listCostco(db)).filter((c) => c.checked);
  if (!checked.length) return;
  await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).in("id", checked.map((c) => c.id));
}
