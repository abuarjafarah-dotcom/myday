import { getServerSession } from "next-auth";
import axios from "axios";
import { authOptions } from "../auth/[...nextauth]";

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.accessToken) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch latest 5 unread emails
    const response = await axios.get(
      "https://www.googleapis.com/gmail/v1/users/me/messages?q=is:unread&maxResults=5",
      {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }
    );

    const messageIds = response.data.messages || [];
    const emails = await Promise.all(
      messageIds.map(async (msg: { id: string }) => {
        const emailRes = await axios.get(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}`,
          {
            headers: { Authorization: `Bearer ${session.accessToken}` },
          }
        );
        const headers = emailRes.data.payload?.headers || [];
        const subject = headers.find((h: { name: string }) => h.name === "Subject")?.value || "(No subject)";
        return { id: msg.id, subject };
      })
    );

    return Response.json({ emails });
  } catch (error) {
    console.error("Gmail API error:", error);
    return Response.json({ error: "Failed to fetch emails" }, { status: 500 });
  }
}
