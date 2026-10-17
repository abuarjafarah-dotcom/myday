import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { HOUSEHOLD, type Who } from "@/lib/household";

// The shared Costco list: one list Farah and Omar both shop from. Lives in the household store
// (owner _household, kind "costco"), so neither person's own grocery sync is touched.
// Checked items drop off after a week so the list never grows forever.

export type CostcoItem = {
  id: string;
  item: string;
  by: Who;
  checked: boolean;
  checkedBy: Who | null;
  checkedAt: number | null;
  createdAt: number;
};

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
const TABLE = "dashboard_docs";
const KIND = "costco";
const KEEP_CHECKED_DAYS = 7;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const cleanItem = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 120);

export async function listCostco(db: Db): Promise<CostcoItem[]> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND);
  const cutoff = Date.now() - KEEP_CHECKED_DAYS * 86400000;
  return ((data || []) as { data: CostcoItem }[])
    .map((r) => r.data)
    .filter((c) => c && c.id && c.item && (!c.checked || (c.checkedAt || 0) >= cutoff))
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function save(db: Db, c: CostcoItem): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .upsert([{ owner: HOUSEHOLD, kind: KIND, id: c.id, data: c, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  if (error) throw new Error(error.message);
}

// Adding something that's already open just returns the existing line, so two people can't double up.
export async function addCostco(db: Db, me: Who, rawItem: unknown): Promise<CostcoItem> {
  const item = cleanItem(rawItem);
  if (!item) throw new Error("item");
  const open = (await listCostco(db)).find((c) => !c.checked && norm(c.item) === norm(item));
  if (open) return open;
  const now = Date.now();
  const c: CostcoItem = {
    id: `c-${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    item, by: me, checked: false, checkedBy: null, checkedAt: null, createdAt: now,
  };
  await save(db, c);
  return c;
}

export async function setCostcoChecked(db: Db, me: Who, id: string, checked: boolean): Promise<CostcoItem | null> {
  const { data } = await db.from(TABLE).select("data").eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id).maybeSingle();
  const cur = (data?.data as CostcoItem) || null;
  if (!cur) return null;
  const next: CostcoItem = { ...cur, checked, checkedBy: checked ? me : null, checkedAt: checked ? Date.now() : null };
  await save(db, next);
  return next;
}

export async function removeCostco(db: Db, id: string): Promise<void> {
  await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).eq("id", id);
}

export async function clearCheckedCostco(db: Db): Promise<void> {
  const checked = (await listCostco(db)).filter((c) => c.checked);
  if (!checked.length) return;
  await db.from(TABLE).delete().eq("owner", HOUSEHOLD).eq("kind", KIND).in("id", checked.map((c) => c.id));
}
