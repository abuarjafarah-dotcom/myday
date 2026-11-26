import { supabaseAdmin } from "@/lib/supabaseAdmin";

// Fitbit on the Today tab, through the Google Health API.
// (Fitbit's own Web API at api.fitbit.com was switched off on Nov 2, 2026; Fitbit data now comes from Google Health.)
//
// One-time setup in the same Google Cloud project as the dashboard's Google sign-in:
//   1. Enable "Google Health API" (health.googleapis.com).
//   2. Data Access: add googlehealth.activity_and_fitness.readonly and googlehealth.sleep.readonly.
//   3. The web OAuth client: add <site>/api/fitbit/callback as an authorized redirect URI.
// It reuses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET, or GOOGLE_HEALTH_CLIENT_ID / _SECRET if set.
//
// The Fitbit link is its own consent and its own refresh token, kept server-side in dashboard_docs
// (owner = Google email, kind "fitbit", id "link"). The dashboard's own sign-in is not touched.

type Db = NonNullable<ReturnType<typeof supabaseAdmin>>;
const TABLE = "dashboard_docs";
const KIND = "fitbit";
const API = "https://health.googleapis.com/v4/users/me";
const TZ = "America/Chicago";
const CACHE_MS = 10 * 60 * 1000;

export const FITBIT_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];

export function clientCreds() {
  const id = process.env.GOOGLE_HEALTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
  const secret = process.env.GOOGLE_HEALTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
  return id && secret ? { id, secret } : null;
}

export type Link = {
  refreshToken: string;
  accessToken?: string;
  expiresAt?: number;      // ms
  scope?: string;
  linkedAt: number;
};

export type Summary = {
  state: "ok" | "disconnected" | "reconnect" | "setup" | "not_linked" | "error";
  date?: string;
  steps?: number | null;
  sleepMinutes?: number | null;
  activeMinutes?: number | null;
  fetchedAt?: number;
  missing?: string[];      // scopes she didn't tick on the consent screen
};

const key = (owner: string, id: string) => ({ owner: owner.toLowerCase(), kind: KIND, id });

async function readDoc<T>(db: Db, owner: string, id: string): Promise<T | null> {
  const k = key(owner, id);
  const { data, error } = await db.from(TABLE).select("data").eq("owner", k.owner).eq("kind", k.kind).eq("id", k.id).maybeSingle();
  if (error) throw error;
  return (data?.data as T) ?? null;
}

async function writeDoc(db: Db, owner: string, id: string, data: unknown) {
  const { error } = await db.from(TABLE).upsert([{ ...key(owner, id), data, updated_at: new Date().toISOString() }], { onConflict: "owner,kind,id" });
  if (error) throw error;
}

async function deleteDoc(db: Db, owner: string, id: string) {
  const k = key(owner, id);
  const { error } = await db.from(TABLE).delete().eq("owner", k.owner).eq("kind", k.kind).eq("id", k.id);
  if (error) throw error;
}

export const readLink = (db: Db, owner: string) => readDoc<Link>(db, owner, "link");
export const saveLink = (db: Db, owner: string, link: Link) => writeDoc(db, owner, "link", link);
export async function unlink(db: Db, owner: string) {
  await deleteDoc(db, owner, "link");
  await deleteDoc(db, owner, "summary");
}

export function authUrl(redirectUri: string, state: string, loginHint?: string) {
  const c = clientCreds();
  const p = new URLSearchParams({
    client_id: c?.id || "",
    redirect_uri: redirectUri,
    response_type: "code",
    scope: FITBIT_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export function missingScopes(scope: string | undefined) {
  const got = new Set(String(scope || "").split(/\s+/));
  return FITBIT_SCOPES.filter(s => !got.has(s)).map(s => s.split(".").slice(-2, -1)[0] || s);
}

export async function exchangeCode(code: string, redirectUri: string): Promise<Link> {
  const c = clientCreds();
  if (!c) throw new Error("not_configured");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || !d.refresh_token) throw new Error(d.error || "no_refresh_token");
  return {
    refreshToken: d.refresh_token,
    accessToken: d.access_token,
    expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000,
    scope: d.scope,
    linkedAt: Date.now(),
  };
}

class ReconnectError extends Error {}
class StateError extends Error {
  state: Summary["state"];
  constructor(state: Summary["state"]) { super(state); this.state = state; }
}

async function accessToken(db: Db, owner: string, link: Link): Promise<string> {
  if (link.accessToken && link.expiresAt && Date.now() < link.expiresAt - 60_000) return link.accessToken;
  const c = clientCreds();
  if (!c) throw new StateError("setup");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, refresh_token: link.refreshToken, grant_type: "refresh_token" }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (d.error === "invalid_grant") throw new ReconnectError("invalid_grant");
    throw new Error("refresh_failed " + res.status);
  }
  const next: Link = {
    ...link,
    accessToken: d.access_token,
    expiresAt: Date.now() + (Number(d.expires_in) || 3600) * 1000,
    refreshToken: d.refresh_token || link.refreshToken,
    scope: d.scope || link.scope,
  };
  await saveLink(db, owner, next);
  return next.accessToken as string;
}

async function call(token: string, path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
    cache: "no-store",
  });
  const d = await res.json().catch(() => ({}));
  if (res.ok) return d;
  const text = JSON.stringify(d);
  if (res.status === 401) throw new ReconnectError("401");
  if (/ACCOUNT_NOT_LINKED/.test(text)) throw new StateError("not_linked");
  if (res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled|ACCESS_TOKEN_SCOPE_INSUFFICIENT|PERMISSION_DENIED/.test(text)) {
    if (/SCOPE_INSUFFICIENT/.test(text)) throw new ReconnectError("scope");
    throw new StateError("setup");
  }
  throw new Error(`health ${res.status} ${text.slice(0, 200)}`);
}

// Today's date in her time zone, and the day after.
export function todayParts(now = new Date()) {
  const s = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const [y, m, d] = s.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    date: s,
    nextDate: next.toISOString().slice(0, 10),
    start: { year: y, month: m, day: d },
    end: { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() },
  };
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

// Rollup values come back like { steps: { countSum: "11245" } }. The exact field for other types may differ,
// so find the first "...Sum" number, else add up anything that looks like minutes.
export function rollupValue(point: unknown): number | null {
  if (!point || typeof point !== "object") return null;
  const skip = new Set(["civilStartTime", "civilEndTime", "startTime", "endTime", "interval", "dataSource"]);
  let sum: number | null = null;
  const minutes: number[] = [];
  const walk = (o: unknown, path: string) => {
    if (sum !== null || !o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (skip.has(k)) continue;
      if (v && typeof v === "object") { walk(v, `${path}.${k}`); continue; }
      const n = num(v);
      if (n === null) continue;
      if (/sum$/i.test(k)) { sum = n; return; }
      if (/minute|count|value/i.test(k)) minutes.push(n);
    }
  };
  walk(point, "");
  if (sum !== null) return sum;
  return minutes.length ? minutes.reduce((a, b) => a + b, 0) : null;
}

async function dailyRollup(token: string, type: string, t: ReturnType<typeof todayParts>) {
  const zero = { hours: 0, minutes: 0, seconds: 0, nanos: 0 };
  const d = await call(token, `/dataTypes/${type}/dataPoints:dailyRollUp`, {
    method: "POST",
    body: JSON.stringify({ range: { start: { date: t.start, time: zero }, end: { date: t.end, time: zero } }, windowSizeDays: 1 }),
  });
  const pts = Array.isArray(d.rollupDataPoints) ? d.rollupDataPoints : [];
  const p = pts.find((x: { civilStartTime?: unknown }) => String(x?.civilStartTime ?? "").includes(t.date)) || pts[0];
  return p ? rollupValue(p) : 0;
}

// Last night's sleep = the main sleep session that ended today.
async function sleepMinutes(token: string, t: ReturnType<typeof todayParts>) {
  const filter = `sleep.interval.civil_end_time >= "${t.date}" AND sleep.interval.civil_end_time < "${t.nextDate}"`;
  const d = await call(token, `/dataTypes/sleep/dataPoints:reconcile?${new URLSearchParams({ filter, pageSize: "25" })}`);
  const pts = (Array.isArray(d.dataPoints) ? d.dataPoints : []).map((p: { sleep?: Record<string, unknown> }) => p.sleep || {});
  if (!pts.length) return null;
  const mins = (s: Record<string, unknown>) => num((s.summary as Record<string, unknown> | undefined)?.minutesAsleep) ?? 0;
  const main = pts.find((s: Record<string, unknown>) => (s.metadata as Record<string, unknown> | undefined)?.mainSleep === true);
  return main ? mins(main) : Math.max(...pts.map(mins));
}

const settle = async <T,>(p: Promise<T>): Promise<{ ok: true; v: T } | { ok: false; e: unknown }> => {
  try { return { ok: true, v: await p }; } catch (e) { return { ok: false, e }; }
};

export async function summary(db: Db, owner: string, opts: { fresh?: boolean } = {}): Promise<Summary> {
  if (!clientCreds()) return { state: "setup" };
  const link = await readLink(db, owner);
  if (!link) return { state: "disconnected" };
  const t = todayParts();
  if (!opts.fresh) {
    const cached = await readDoc<Summary>(db, owner, "summary").catch(() => null);
    if (cached && cached.state === "ok" && cached.date === t.date && cached.fetchedAt && Date.now() - cached.fetchedAt < CACHE_MS) return cached;
  }
  try {
    const token = await accessToken(db, owner, link);
    const [steps, active, sleep] = await Promise.all([
      settle(dailyRollup(token, "steps", t)),
      settle(dailyRollup(token, "active-minutes", t)),
      settle(sleepMinutes(token, t)),
    ]);
    const all = [steps, active, sleep];
    const firstErr = all.find(r => !r.ok) as { ok: false; e: unknown } | undefined;
    if (all.every(r => !r.ok) && firstErr) throw firstErr.e;
    for (const r of all) if (!r.ok) console.error("Fitbit partial error", r.e);
    const out: Summary = {
      state: "ok",
      date: t.date,
      steps: steps.ok ? steps.v : null,
      activeMinutes: active.ok ? active.v : null,
      sleepMinutes: sleep.ok ? sleep.v : null,
      fetchedAt: Date.now(),
      missing: missingScopes(link.scope),
    };
    await writeDoc(db, owner, "summary", out).catch(() => {});
    return out;
  } catch (e) {
    if (e instanceof ReconnectError) return { state: "reconnect" };
    if (e instanceof StateError) return { state: e.state };
    console.error("Fitbit summary failed", e);
    return { state: "error" };
  }
}
