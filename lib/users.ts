// Who is who. One codebase, two private dashboards.
// Every row in Supabase is keyed by the signed-in Google email, so each person only ever reads their own data.
//
//   OMAR_EMAIL                  Omar's Google sign-in email. He lands on /omar.
//   ICLOUD_CALENDAR_URLS        Farah's phone (iCloud) calendars. Never shown to Omar.
//   ICLOUD_CALENDAR_URLS_OMAR   Omar's phone (iCloud) calendars. Never shown to Farah.
//   CAPTURE_TOKEN / CAPTURE_EMAIL        Farah's voice shortcut (unchanged).
//   CAPTURE_TOKEN_OMAR                   Omar's voice shortcut; entries go to OMAR_EMAIL.

export type View = "farah" | "omar";

const norm = (s: string | null | undefined) => String(s || "").trim().toLowerCase();

export function omarEmail(): string {
  return norm(process.env.OMAR_EMAIL);
}

export function viewFor(email: string | null | undefined): View {
  const e = norm(email);
  const omar = omarEmail();
  return omar && e === omar ? "omar" : "farah";
}

export const homePath = (view: View) => (view === "omar" ? "/omar" : "/dashboard");

// Phone calendar feeds belong to one person each.
export function icloudUrlsFor(email: string | null | undefined): string {
  return viewFor(email) === "omar" ? process.env.ICLOUD_CALENDAR_URLS_OMAR || "" : process.env.ICLOUD_CALENDAR_URLS || "";
}
