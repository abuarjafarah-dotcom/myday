import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFarah, partnerDays } from "@/lib/partner";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Farah's "Omar this week" strip. Only Farah can read it, and only once Omar has turned sharing on.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!isFarah(session.user.email)) return Response.json({ error: "Not available" }, { status: 403 });
  const db = supabaseAdmin();
  if (!db) return Response.json({ error: "not_configured" }, { status: 503 });
  return Response.json(await partnerDays(db), { headers: { "Cache-Control": "no-store" } });
}
