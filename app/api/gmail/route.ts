import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.accessToken || session.error) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const auth = { Authorization: `Bearer ${session.accessToken}` };
  try {
    const list = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread%20in:inbox%20category:primary&maxResults=8",
      { headers: auth, cache: "no-store" }
    );
    if (list.status === 401) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const data = await list.json();
    const ids: { id: string }[] = data.messages || [];
    const emails = await Promise.all(
      ids.map(async ({ id }) => {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
          { headers: auth, cache: "no-store" }
        );
        const m = await r.json();
        const headers: { name: string; value: string }[] = m.payload?.headers || [];
        const get = (n: string) => headers.find((h) => h.name === n)?.value || "";
        const from = get("From").replace(/\s*<[^>]+>\s*$/, "").replace(/^"|"$/g, "");
        return { id, threadId: m.threadId, subject: get("Subject") || "(No subject)", from };
      })
    );
    return Response.json({ emails });
  } catch (error) {
    console.error("Gmail API error:", error);
    return Response.json({ error: "Failed to fetch emails" }, { status: 500 });
  }
}
