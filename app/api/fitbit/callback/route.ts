import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { whoIs } from "@/lib/household";
import { exchangeCode, missingScopes, saveLink } from "@/lib/fitbit";

export const dynamic = "force-dynamic";

// Google sends her back here after she allows Fitbit data. Saves the link, then returns to the Today tab.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const back = (result: string) => {
    const headers = new Headers({ Location: new URL(`/dashboard?fitbit=${result}`, url.origin).toString() });
    headers.append("Set-Cookie", "fitbit_state=; Path=/api/fitbit; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return new Response(null, { status: 302, headers });
  };

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || null;
  if (!email || !whoIs(email)) return back("signin");

  const cookie = (request.headers.get("cookie") || "").split(/;\s*/).find(x => x.startsWith("fitbit_state="))?.slice(13) || "";
  const state = url.searchParams.get("state") || "";
  if (!cookie || cookie !== state) return back("expired");
  if (url.searchParams.get("error")) return back("declined");
  const code = url.searchParams.get("code");
  if (!code) return back("error");

  const db = supabaseAdmin();
  if (!db) return back("setup");
  try {
    const link = await exchangeCode(code, `${url.origin}/api/fitbit/callback`);
    await saveLink(db, email, link);
    return back(missingScopes(link.scope).length ? "partial" : "connected");
  } catch (e) {
    console.error("Fitbit connect failed", e);
    return back("error");
  }
}
