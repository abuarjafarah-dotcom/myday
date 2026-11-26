import { getServerSession } from "next-auth";
import { randomBytes } from "node:crypto";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { whoIs } from "@/lib/household";
import { authUrl, clientCreds, summary, unlink } from "@/lib/fitbit";

export const dynamic = "force-dynamic";

// Fitbit card on the Today tab.
//   GET                    { state, date, steps, sleepMinutes, activeMinutes, fetchedAt }
//   GET ?fresh=1           same, skipping the 10-minute cache
//   GET ?action=connect    sends her to Google to allow Fitbit data (then back to /api/fitbit/callback)
//   POST { op: "disconnect" }
const noStore = { "Cache-Control": "no-store" };

async function who() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || null;
  if (!email) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!whoIs(email)) return { error: Response.json({ error: "Not available" }, { status: 403 }) };
  const db = supabaseAdmin();
  if (!db) return { error: Response.json({ state: "setup" }, { headers: noStore }) };
  return { email, db };
}

export async function GET(request: Request) {
  const c = await who();
  if ("error" in c) return c.error;
  const url = new URL(request.url);
  if (url.searchParams.get("action") === "connect") {
    if (!clientCreds()) return Response.redirect(new URL("/dashboard?fitbit=setup", url.origin), 302);
    const state = randomBytes(18).toString("base64url");
    const headers = new Headers({ Location: authUrl(`${url.origin}/api/fitbit/callback`, state, c.email) });
    headers.append("Set-Cookie", `fitbit_state=${state}; Path=/api/fitbit; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    return new Response(null, { status: 302, headers });
  }
  const s = await summary(c.db, c.email, { fresh: url.searchParams.get("fresh") === "1" });
  return Response.json(s, { headers: noStore });
}

export async function POST(request: Request) {
  const c = await who();
  if ("error" in c) return c.error;
  const body = (await request.json().catch(() => null)) as { op?: string } | null;
  if (body?.op === "disconnect") {
    await unlink(c.db, c.email);
    return Response.json({ state: "disconnected" }, { headers: noStore });
  }
  return Response.json({ error: "bad_request" }, { status: 400 });
}
