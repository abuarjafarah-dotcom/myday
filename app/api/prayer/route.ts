// Prayer times for Rochester, MN from the free Aladhan API (no key). ISNA method.
// GET /api/prayer?date=YYYY-MM-DD -> { date, times: { Fajr, Dhuhr, Asr, Maghrib, Isha }, hijri: { day, month, monthName, year } }
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("date") || "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(q);
  if (!m) return Response.json({ error: "bad_date" }, { status: 400 });
  try {
    const response = await fetch(
      `https://api.aladhan.com/v1/timings/${m[3]}-${m[2]}-${m[1]}?latitude=44.0121&longitude=-92.4802&method=2&timezonestring=America%2FChicago`,
      { next: { revalidate: 21600 } } as RequestInit
    );
    if (!response.ok) return Response.json({ error: "unavailable" }, { status: 502 });
    const data = await response.json();
    const t = data?.data?.timings;
    const h = data?.data?.date?.hijri;
    if (!t) return Response.json({ error: "unavailable" }, { status: 502 });
    const pick = (k: string) => (typeof t[k] === "string" ? (t[k] as string).slice(0, 5) : null);
    return Response.json({
      date: q,
      times: { Fajr: pick("Fajr"), Dhuhr: pick("Dhuhr"), Asr: pick("Asr"), Maghrib: pick("Maghrib"), Isha: pick("Isha") },
      hijri: h ? { day: h.day, month: h.month?.number ?? null, monthName: h.month?.en ?? null, year: h.year } : null,
      method: "ISNA",
      place: "Rochester, MN",
    });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 502 });
  }
}
