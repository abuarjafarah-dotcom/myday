import { createHash, createPrivateKey, generateKeyPairSync, sign, type JsonWebKey as NodeJwk } from "node:crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Reminder notifications (Web Push, no extra packages).
//   GET  ?action=key        public key the browser needs to subscribe
//   POST ?action=subscribe  { subscription, tz }   save this phone (signed in)
//   POST ?action=unsubscribe { endpoint }          remove this phone (signed in)
//   POST ?action=test                               send a test reminder (signed in)
//   GET  ?action=pending&e=<id>                     the service worker asks "what do I show?"
//   GET  ?action=tick                               called every few minutes by a scheduler; sends whatever is due
// Pushes carry no content. The phone wakes up, asks /pending, and shows the message. Keys and phones live in the
// same Supabase table as the rest of the dashboard (kinds "push-keys", "push-sub", "push-state"), invisible to the app's store API.

const TABLE = "dashboard_docs";
type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
type Doc = Record<string, unknown>;
type Row = { owner: string; kind: string; id: string; data: Doc };
type Msg = { title: string; body: string; url: string; tag: string };
type Vapid = { publicKey: string; jwk: NodeJwk };
type Out = Msg & { key: string };

const BED_MIN = 21 * 60;
const WAKE_MIN = 5 * 60;
const MAX_SUBS = 5;

async function getDoc(db: Db, owner: string, kind: string, id: string): Promise<Doc | null> {
  const { data } = await db.from(TABLE).select("data").eq("owner", owner).eq("kind", kind).eq("id", id).maybeSingle();
  return (data?.data as Doc) || null;
}
async function putDoc(db: Db, owner: string, kind: string, id: string, data: Doc, ignoreDuplicates = false): Promise<void> {
  await db
    .from(TABLE)
    .upsert([{ owner, kind, id, data, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id", ignoreDuplicates });
}
async function delDoc(db: Db, owner: string, kind: string, id: string): Promise<void> {
  await db.from(TABLE).delete().eq("owner", owner).eq("kind", kind).eq("id", id);
}

// ---------- keys and sending ----------
async function vapid(db: Db): Promise<Vapid> {
  const have = await getDoc(db, "_app", "push-keys", "vapid");
  if (have && typeof have.publicKey === "string" && have.jwk) return have as unknown as Vapid;
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(String(pub.x), "base64url"), Buffer.from(String(pub.y), "base64url")]);
  const doc = { publicKey: raw.toString("base64url"), jwk } as unknown as Doc;
  await putDoc(db, "_app", "push-keys", "vapid", doc, true);          // first writer wins
  return ((await getDoc(db, "_app", "push-keys", "vapid")) || doc) as unknown as Vapid;
}

function vapidAuth(v: Vapid, endpoint: string, subject: string): string {
  const head = Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })).toString("base64url");
  const key = createPrivateKey({ key: v.jwk, format: "jwk" });
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" }).toString("base64url");
  return `vapid t=${head}.${body}.${sig}, k=${v.publicKey}`;
}

const subId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 32);

async function ping(v: Vapid, endpoint: string, subject: string): Promise<number> {
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { Authorization: vapidAuth(v, endpoint, subject), TTL: "7200", Urgency: "normal" } });
    return r.status;
  } catch {
    return 0;
  }
}

async function deliver(db: Db, v: Vapid, sub: Row, msg: Msg): Promise<boolean> {
  const endpoint = String(sub.data.endpoint || "");
  if (!endpoint) return false;
  const pending = [...((sub.data.pending as Msg[]) || []), msg].slice(-5);
  sub.data = { ...sub.data, pending };                      // keep the local copy current when several reminders go out together
  await putDoc(db, sub.owner, "push-sub", sub.id, sub.data);
  const status = await ping(v, endpoint, `mailto:${sub.owner}`);
  if (status === 404 || status === 410) {
    await delDoc(db, sub.owner, "push-sub", sub.id);
    return false;
  }
  return status >= 200 && status < 300;
}

// ---------- what is due ----------
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function localNow(tz: string, d: Date = new Date()): { date: string; min: number; dow: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(d);
  } catch {
    return localNow("America/Chicago", d);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, min: Number(get("hour")) * 60 + Number(get("minute")), dow: DOW.indexOf(get("weekday")) };
}
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + n);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}
function toMin(t: unknown): number | null {
  const m = String(t || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] || 0);
  const ap = (m[3] || "").toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  return h * 60 + mi;
}
const clock = (min: number) => `${((Math.floor(min / 60) + 11) % 12) + 1}:${String(min % 60).padStart(2, "0")} ${Math.floor(min / 60) % 24 >= 12 ? "PM" : "AM"}`;
const isOpen = (t: Doc) => t.status === "todo" || t.status === "doing";

function workActive(work: unknown, now: { date: string; min: number; dow: number }): { start: number; end: number } | null {
  const w = (work || {}) as Doc;
  if (!w.on) return null;
  if (typeof w.from === "string" && now.date < w.from) return null;
  const days = Array.isArray(w.days) ? (w.days as number[]) : [1, 2, 3, 4, 5];
  if (!days.includes(now.dow)) return null;
  const start = toMin(w.start || "09:00");
  const end = toMin(w.end || "17:00");
  if (start === null || end === null || now.min < start || now.min >= end) return null;
  return { start, end };
}

function dueMessages(now: { date: string; min: number; dow: number }, tasks: Doc[], meta: Doc, sent: Record<string, number>): Out[] {
  const cfg = (meta.notify || {}) as Doc;
  if (cfg.on === false || !cfg.on) return [];
  if (now.min >= BED_MIN || now.min < WAKE_MIN) return [];
  const out: Out[] = [];
  const push = (key: string, title: string, body: string) => {
    if (!sent[key]) out.push({ key, title, body, url: "/dashboard", tag: key });
  };
  const inWindow = (at: number, width = 25) => now.min >= at && now.min < at + width;
  const work = workActive(meta.work, now);
  const open = tasks.filter(isOpen);
  const today = open.filter((t) => t.date === now.date);
  const carried = open.filter((t) => typeof t.date === "string" && t.date < now.date);
  const names = (list: Doc[], n = 3) => list.slice(0, n).map((t) => String(t.title)).join(", ") + (list.length > n ? ` +${list.length - n} more` : "");

  const morning = toMin(cfg.morning || "05:30");
  if (morning !== null && inWindow(morning)) {
    const timed = today.filter((t) => toMin(t.time) !== null).sort((a, b) => (toMin(a.time) as number) - (toMin(b.time) as number));
    const dueToday = open.filter((t) => t.due === now.date);
    const parts = [`${today.length} on today's list${carried.length ? `, ${carried.length} carried over` : ""}.`];
    if (timed.length) parts.push(`First: ${timed[0].title} at ${timed[0].time}.`);
    if (dueToday.length) parts.push(`Due today: ${names(dueToday)}.`);
    if (work) parts.push(`Work day until ${clock(work.end)}.`);
    push(`morning-${now.date}`, "Good morning", parts.join(" "));
  }
  const wind = toMin(cfg.wind || "20:30");
  if (wind !== null && inWindow(wind)) {
    const left = today.filter((t) => t.category !== "omar");
    push(`wind-${now.date}`, "Wind down", left.length ? `${left.length} left today. Move them to tomorrow and rest.` : "Everything is done. Time to rest.");
  }
  if (cfg.due !== false && inWindow(18 * 60)) {
    const tomorrow = open.filter((t) => t.due === addDays(now.date, 1));
    if (tomorrow.length) push(`dueeve-${now.date}`, "Due tomorrow", names(tomorrow));
  }
  if (cfg.timed !== false) {
    const quiet = (t: Doc) => !!work && !["work", "kids", "omar"].includes(String(t.category));
    today.forEach((t) => {
      const m = toMin(t.time);
      if (m !== null && !quiet(t) && now.min >= m - 15 && now.min < m) push(`t-${String(t.id)}-${now.date}`, "In 15 minutes", `${t.title} at ${t.time}`);
    });
    (Array.isArray(meta.keyTimes) ? (meta.keyTimes as unknown[]) : []).forEach((k) => {
      const hit = String(k).match(/(\d{1,2}(?::\d{2})?\s*[ap]\.?\s*m\.?)/i);
      const m = hit ? toMin(hit[1].replace(/\s+/g, " ")) : null;
      if (hit && m !== null && now.min >= m - 15 && now.min < m) {
        const label = String(k).replace(hit[1], "").replace(/[:\-–@]+\s*$/, "").replace(/\bat\s*$/i, "").trim() || "Key time";
        push(`k-${createHash("md5").update(String(k)).digest("hex").slice(0, 8)}-${now.date}`, "In 15 minutes", `${label} at ${clock(m)}`);
      }
    });
  }
  return out;
}

async function tick(db: Db): Promise<Response> {
  const v = await vapid(db);
  const { data: subRows } = await db.from(TABLE).select("owner,id,data").eq("kind", "push-sub");
  const byOwner = new Map<string, Row[]>();
  ((subRows || []) as Row[]).forEach((r) => byOwner.set(r.owner, [...(byOwner.get(r.owner) || []), { ...r, kind: "push-sub" }]));
  let sentCount = 0;
  for (const [owner, subs] of byOwner) {
    const { data: rows } = await db.from(TABLE).select("kind,id,data").eq("owner", owner).in("kind", ["tasks", "meta"]);
    const list = (rows || []) as Row[];
    const tasks = list.filter((r) => r.kind === "tasks").map((r) => r.data);
    const meta = (list.find((r) => r.kind === "meta" && r.id === "main")?.data || {}) as Doc;
    const tz = String(subs[0].data.tz || "America/Chicago");
    const now = localNow(tz);
    const state = (await getDoc(db, owner, "push-state", "main")) || {};
    const sent = { ...((state.sent as Record<string, number>) || {}) };
    const cutoff = Date.now() - 3 * 86400000;
    Object.keys(sent).forEach((k) => { if (sent[k] < cutoff) delete sent[k]; });
    const due = dueMessages(now, tasks, meta, sent);
    for (const m of due) {
      sent[m.key] = Date.now();
      for (const s of subs) if (await deliver(db, v, s, { title: m.title, body: m.body, url: m.url, tag: m.tag })) sentCount++;
    }
    if (due.length) await putDoc(db, owner, "push-state", "main", { sent });
  }
  return Response.json({ ok: true, owners: byOwner.size, sent: sentCount });
}

// ---------- routes ----------
async function sessionEmail(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.email?.toLowerCase() || null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "not_configured" }, { status: 503 });
  try {
    if (action === "key") return Response.json({ publicKey: (await vapid(db)).publicKey });
    if (action === "pending") {
      const id = (url.searchParams.get("e") || "").replace(/[^a-f0-9]/g, "").slice(0, 32);
      const fallback: Msg = { title: "myday", body: "Open your dashboard", url: "/dashboard", tag: "myday" };
      if (!id) return Response.json(fallback);
      const { data } = await db.from(TABLE).select("owner,id,data").eq("kind", "push-sub").eq("id", id).limit(1);
      const row = ((data || []) as Row[])[0];
      if (!row) return Response.json(fallback);
      const queue = ((row.data.pending as Msg[]) || []).slice();
      const next = queue.shift();
      if (next) await putDoc(db, row.owner, "push-sub", row.id, { ...row.data, pending: queue });
      return Response.json(next || fallback, { headers: { "Cache-Control": "no-store" } });
    }
    if (action === "tick") {
      const secret = process.env.TICK_SECRET;
      if (secret && url.searchParams.get("key") !== secret) return Response.json({ error: "Unauthorized" }, { status: 401 });
      return await tick(db);
    }
    return Response.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    console.error("push GET", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action") || "";
  const email = await sessionEmail();
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "not_configured" }, { status: 503 });
  try {
    if (action === "subscribe") {
      const body = (await request.json().catch(() => ({}))) as { subscription?: { endpoint?: string }; tz?: string };
      const endpoint = String(body.subscription?.endpoint || "");
      if (!/^https:\/\//.test(endpoint) || endpoint.length > 700) return Response.json({ error: "bad_subscription" }, { status: 400 });
      const id = subId(endpoint);
      const { data } = await db.from(TABLE).select("id,data").eq("owner", email).eq("kind", "push-sub");
      const mine = ((data || []) as Row[]).filter((r) => r.id !== id);
      for (const old of mine.slice(0, Math.max(0, mine.length - (MAX_SUBS - 1)))) await delDoc(db, email, "push-sub", old.id);
      await putDoc(db, email, "push-sub", id, { endpoint, tz: String(body.tz || "America/Chicago").slice(0, 60), createdAt: Date.now(), pending: [] });
      return Response.json({ ok: true, id });
    }
    if (action === "unsubscribe") {
      const body = (await request.json().catch(() => ({}))) as { endpoint?: string };
      if (body.endpoint) await delDoc(db, email, "push-sub", subId(String(body.endpoint)));
      return Response.json({ ok: true });
    }
    if (action === "test") {
      const v = await vapid(db);
      const { data } = await db.from(TABLE).select("owner,id,data").eq("owner", email).eq("kind", "push-sub");
      const subs = ((data || []) as Row[]).map((r) => ({ ...r, kind: "push-sub" }));
      let sent = 0;
      for (const s of subs) if (await deliver(db, v, s, { title: "myday", body: "Reminders are on. This is a test.", url: "/dashboard", tag: "test" })) sent++;
      return Response.json({ ok: true, phones: subs.length, sent });
    }
    return Response.json({ error: "unknown_action" }, { status: 400 });
  } catch (error) {
    console.error("push POST", error instanceof Error ? error.message : "unknown");
    return Response.json({ error: "failed" }, { status: 500 });
  }
}
