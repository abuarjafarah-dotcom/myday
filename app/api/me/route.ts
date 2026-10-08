import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { homePath, viewFor } from "@/lib/users";

export const dynamic = "force-dynamic";

// Which dashboard belongs to the signed-in person.
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email || null;
  if (!email) return Response.json({ signedIn: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const view = viewFor(email);
  return Response.json(
    { signedIn: true, view, home: homePath(view), name: session?.user?.name || "", needsReauth: !!session?.error },
    { headers: { "Cache-Control": "no-store" } }
  );
}
