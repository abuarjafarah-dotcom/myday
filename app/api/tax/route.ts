import { createHash, randomUUID } from "crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { whoIs } from "@/lib/household";

export const dynamic = "force-dynamic";

// Tax deduction tracker (federal + Minnesota). Owner only; every row is keyed by the signed-in email.
//   GET                                   { buckets, transactions, rules, settings }
//   POST { op: "add", txn_date, description, amount, card?, bucket?, note? }
//   POST { op: "rebucket", id, bucket, learn? }   learn=true saves a keyword rule from the description
//   POST { op: "delete", id }
//   POST { op: "import", rows: [{ date, description, amount, card? }] }   auto-sorts, skips duplicates
//   POST { op: "rule-add", keyword, bucket }
//   POST { op: "rule-del", keyword }
//   POST { op: "setting", key, value }

const DEFAULT_RULES: [string, string][] = [
  ["staples", "sched_c"], ["adobe", "sched_c"], ["figma", "sched_c"],
  ["daycare", "childcare"], ["kindercare", "childcare"], ["bright horizons", "childcare"],
  ["montessori", "childcare"], ["bright start", "childcare"], ["care.com", "childcare"],
  ["mortgage", "mortgage"], ["property tax", "proptax"], ["red cross", "charity"],
  ["pharmacy", "medical"], ["cvs", "medical"], ["walgreens", "medical"],
  ["uber", "personal"], ["lyft", "personal"], ["costco", "personal"],
];
const SETTING_KEYS = ["agi", "mn_standard_deduction", "mortgage_interest", "property_tax", "charitable_gifts"];

async function context() {
  const session = await getServerSession(authOptions);
  const email = (session?.user?.email || "").trim().toLowerCase();
  if (!email) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (whoIs(email) !== "farah") return { error: Response.json({ error: "Not available" }, { status: 403 }) };
  const db = supabaseAdmin();
  if (!db) return { error: Response.json({ error: "not_configured" }, { status: 503 }) };
  return { email, db };
}

type Rule = { keyword: string; bucket: string };

function classify(desc: string, rules: Rule[]): string {
  const l = desc.toLowerCase();
  const hit = [...rules].sort((a, b) => b.keyword.length - a.keyword.length).find((r) => l.includes(r.keyword.toLowerCase()));
  return hit ? hit.bucket : "review";
}

// Keyword learned from a description: first two words, at least four characters.
function learnKeyword(desc: string): string | null {
  const w = desc.toLowerCase().replace(/[^a-z0-9 ]/g, " ").trim().split(/\s+/).slice(0, 2).join(" ");
  return w.length >= 4 ? w : null;
}

// Same key the import has always used, so re-uploading a statement is a no-op.
function dedupeKey(base: string, seq: number): string {
  return createHash("sha256").update(`${base}|${seq}`).digest("hex");
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function ensureDefaults(db: NonNullable<ReturnType<typeof supabaseAdmin>>, email: string) {
  const { data: flag } = await db.from("tax_settings").select("value").eq("owner_email", email).eq("key", "rules_seeded").maybeSingle();
  if (flag) return;
  await db.from("tax_rules").upsert(DEFAULT_RULES.map(([keyword, bucket]) => ({ owner_email: email, keyword, bucket })), { onConflict: "owner_email,keyword", ignoreDuplicates: true });
  await db.from("tax_settings").upsert({ owner_email: email, key: "rules_seeded", value: 1 }, { onConflict: "owner_email,key" });
}

export async function GET() {
  const c = await context();
  if ("error" in c) return c.error;
  const { email, db } = c;
  await ensureDefaults(db, email);
  const [b, r, s, t] = await Promise.all([
    db.from("tax_buckets").select("*").order("id"),
    db.from("tax_rules").select("keyword, bucket").eq("owner_email", email).order("keyword"),
    db.from("tax_settings").select("key, value").eq("owner_email", email),
    db.from("tax_transactions").select("id, txn_date, description, amount, card, bucket, note").eq("owner_email", email).order("txn_date", { ascending: false }).range(0, 9999),
  ]);
  const err = [b, r, s, t].find((x) => x.error);
  if (err?.error) return Response.json({ error: err.error.message }, { status: 500 });
  return Response.json(
    {
      buckets: b.data,
      rules: r.data,
      settings: Object.fromEntries((s.data || []).filter((x) => SETTING_KEYS.includes(x.key)).map((x) => [x.key, x.value])),
      transactions: (t.data || []).map((x) => ({ id: x.id, date: x.txn_date, desc: x.description, amount: Number(x.amount), card: x.card, bucket: x.bucket, note: x.note })),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  const c = await context();
  if ("error" in c) return c.error;
  const { email, db } = c;
  const body = await req.json().catch(() => null);
  if (!body || typeof body.op !== "string") return Response.json({ error: "bad_request" }, { status: 400 });

  const { data: bucketRows } = await db.from("tax_buckets").select("id");
  const bucketIds = new Set((bucketRows || []).map((x) => x.id as string));
  const validBucket = (v: unknown) => typeof v === "string" && bucketIds.has(v);

  const fail = (message: string, status = 400) => Response.json({ error: message }, { status });

  switch (body.op) {
    case "add": {
      const desc = String(body.description || "").trim();
      const amount = Number(body.amount);
      if (!DATE.test(String(body.txn_date || "")) || !desc || !(amount > 0)) return fail("Date, description and a positive amount are required.");
      const { data: rules } = await db.from("tax_rules").select("keyword, bucket").eq("owner_email", email);
      const bucket = validBucket(body.bucket) ? body.bucket : classify(desc, (rules as Rule[]) || []);
      const { error } = await db.from("tax_transactions").insert({
        owner_email: email, txn_date: body.txn_date, description: desc, amount, card: String(body.card || "").trim(),
        bucket, note: String(body.note || "").trim(), source: "manual", dedupe_key: randomUUID(),
      });
      if (error) return fail(error.message, 500);
      return Response.json({ ok: true });
    }

    case "rebucket": {
      if (!validBucket(body.bucket)) return fail("Unknown bucket.");
      const { data: row } = await db.from("tax_transactions").select("description").eq("owner_email", email).eq("id", body.id).maybeSingle();
      if (!row) return fail("Not found.", 404);
      const { error } = await db.from("tax_transactions").update({ bucket: body.bucket }).eq("owner_email", email).eq("id", body.id);
      if (error) return fail(error.message, 500);
      const kw = body.learn ? learnKeyword(row.description as string) : null;
      if (kw) await db.from("tax_rules").upsert({ owner_email: email, keyword: kw, bucket: body.bucket }, { onConflict: "owner_email,keyword" });
      return Response.json({ ok: true, learned: kw });
    }

    case "delete": {
      const { error } = await db.from("tax_transactions").delete().eq("owner_email", email).eq("id", body.id);
      if (error) return fail(error.message, 500);
      return Response.json({ ok: true });
    }

    case "import": {
      const input = Array.isArray(body.rows) ? body.rows : [];
      if (!input.length) return fail("No rows.");
      const { data: rules } = await db.from("tax_rules").select("keyword, bucket").eq("owner_email", email);
      const seen: Record<string, number> = {};
      const rows = [];
      for (const r of input) {
        const date = String(r.date || "");
        const desc = String(r.description || "").trim();
        const amount = Math.round(Number(r.amount) * 100) / 100;
        const card = String(r.card || "").trim();
        if (!DATE.test(date) || !desc || !(amount > 0)) continue;
        const base = `${date}|${desc.toLowerCase()}|${amount.toFixed(2)}|${card.toLowerCase()}`;
        seen[base] = (seen[base] || 0) + 1;
        rows.push({
          owner_email: email, txn_date: date, description: desc, amount, card,
          bucket: classify(desc, (rules as Rule[]) || []), note: "", source: "csv", dedupe_key: dedupeKey(base, seen[base]),
        });
      }
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 500) {
        const { data, error } = await db.from("tax_transactions")
          .upsert(rows.slice(i, i + 500), { onConflict: "owner_email,dedupe_key", ignoreDuplicates: true })
          .select("id");
        if (error) return fail(error.message, 500);
        inserted += data?.length || 0;
      }
      return Response.json({ ok: true, inserted, skipped: rows.length - inserted });
    }

    case "rule-add": {
      const kw = String(body.keyword || "").trim().toLowerCase();
      if (!kw || !validBucket(body.bucket)) return fail("Keyword and a valid bucket are required.");
      const { error } = await db.from("tax_rules").upsert({ owner_email: email, keyword: kw, bucket: body.bucket }, { onConflict: "owner_email,keyword" });
      if (error) return fail(error.message, 500);
      return Response.json({ ok: true });
    }

    case "rule-del": {
      const { error } = await db.from("tax_rules").delete().eq("owner_email", email).eq("keyword", String(body.keyword || ""));
      if (error) return fail(error.message, 500);
      return Response.json({ ok: true });
    }

    case "setting": {
      if (!SETTING_KEYS.includes(body.key)) return fail("Unknown setting.");
      const value = body.value === null || body.value === "" ? null : Number(body.value);
      const { error } = await db.from("tax_settings").upsert({ owner_email: email, key: body.key, value }, { onConflict: "owner_email,key" });
      if (error) return fail(error.message, 500);
      return Response.json({ ok: true });
    }

    default:
      return fail("Unknown op.");
  }
}
