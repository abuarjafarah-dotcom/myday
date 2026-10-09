import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { smartSave } from "@/lib/smartSave";
import { smartSaveFarah } from "@/lib/smartFarah";
import { viewFor } from "@/lib/users";

export const dynamic = "force-dynamic";

// "Smart add" box on the dashboard: same free rule-based filter as the voice shortcut, saved for whoever is signed in.
export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase();
  if (!email) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { text?: unknown; tz?: unknown };
  const text = String(body.text || "").replace(/\r\n/g, "\n").trim().slice(0, 5000);
  if (!text) return Response.json({ error: "Nothing to add." }, { status: 400 });
  const opts = { tz: String(body.tz || "America/Chicago").slice(0, 60), source: "smart-add" };
  // Each person gets their own tags: Omar's work types on /omar, Farah's kids/work/errands/... on /dashboard.
  const result = viewFor(email) === "omar" ? await smartSave(email, text, opts) : await smartSaveFarah(email, text, opts);
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
  return Response.json({ ok: true, message: result.message, items: result.items, reminders: result.reminders });
}
