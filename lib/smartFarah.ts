import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { findDate, humanWhen, localToday, parseCapture, splitItems } from "@/lib/smart";

// Farah's smart filter: the same free, rule-based parser Omar's capture uses (dates, times, priority, reminders),
// with Farah's tags — kids, work, home, errands, self, activity, omar — plus grocery items filed under a store
// and "Note: ..." / "Idea: ..." saved as ideas. Used by the back-tap shortcut (/api/capture with CAPTURE_TOKEN)
// so voice notes land on /dashboard already tagged, with no review step.

const TABLE = "dashboard_docs";

export type FarahTag = "kids" | "work" | "home" | "errands" | "self" | "activity" | "omar";
export const TAG_LABEL: Record<FarahTag, string> = {
  kids: "Kids", work: "Work", home: "Home", errands: "Errands", self: "Self", activity: "Activity", omar: "Omar",
};
const DEFAULT_STORES = ["Costco", "Trader Joe's", "Target", "Walmart", "Amazon", "Aldi", "Other"];
const STORE_ALIASES: Record<string, string> = { "tj s": "Trader Joe's", tjs: "Trader Joe's", "trader joes": "Trader Joe's" };

// Order matters: the first rule that matches wins.
const TAG_RULES: [FarahTag, RegExp][] = [
  ["omar", /\b(omar|husband|hubby)\b/i],
  ["kids", /\b(hamad|talal|yousef|yusuf|kids?|children|boys|baby|school|daycare|pre-?k|preschool|teacher|pediatric(?:ian)?|diapers?|nap|bath(?: ?time)?|bedtime|homework|nanny|babysitter|soccer|swim (?:class|lesson)s?|ot\b|rms|playdate|play date|car ?seat|stroller|lunchbox|lunches)\b/i],
  ["work", /\b(workwave|work|job|portfolio|resume|cv|linkedin|recruiter|onboard(?:ing)?|interview|meeting|standup|stand-up|client|stakeholder|figma|deck|slides?|presentation|case study|design review|manager|team|offer letter|i-?9|w-?4|course|certificate|deadline)\b/i],
  ["self", /\b(gym|workout|work out|yoga|pilates|run(?:ning)?|walk|stretch|shower|nails|manicure|pedicure|hair(?:cut)?|brows?|facial|skin ?care|massage|therapy|journal|read(?:ing)?|book club|pray(?:er)?|quran|meditat\w*|rest|sleep|me time|self[- ]care|dentist|doctor|dermatolog\w*|eye exam|sew(?:ing)?|quilt)\b/i],
  ["activity", /\b(stroll|backyard|park|library|museum|zoo|outing|picking|pumpkin patch|apple orchard|farm|playground|splash pad|story ?time|class\b|lesson|festival|fest|carving|craft|trip to|day trip|hike|beach|movie)\b/i],
  ["errands", /\b(buy|pick ?up|drop ?off|return|exchange|order|ship|mail|post office|ups|fedex|usps|bank|atm|dmv|walgreens|cvs|pharmacy|prescription|refill|costco|target|walmart|aldi|amazon|trader|grocer(?:y|ies)|shopping|car wash|oil change|gas|dry clean\w*|call|appointment|appt|renew|pay|bill)\b/i],
  ["home", /\b(laundry|clean|tidy|vacuum|mop|dishes|dishwasher|cook|dinner|lunch|breakfast|meal prep|bake|make|fix|repair|plumber|organi[sz]e|declutter|garden|plants?|water|trash|recycling|bed sheets|reset)\b/i],
];

export function farahTag(text: string): FarahTag {
  return matchedTag(text) || "home";
}
function matchedTag(text: string): FarahTag | null {
  for (const [tag, re] of TAG_RULES) if (re.test(text)) return tag;
  return null;
}

const GROCERY_WORDS = /\b(yogh?urts?|milk|eggs?|bread|berr(?:y|ies)|blueberr\w*|strawberr\w*|raspberr\w*|chicken|beef|ground beef|lamb|turkey|fish|salmon|shrimp|rice|cheese|fruits?|apples?|bananas?|grapes|oranges?|clementines?|avocados?|lemons?|limes?|water|oil|diapers?|wipes|formula|puffs|pouch(?:es)?|pasta|tomato(?:es)?|onions?|garlic|potato(?:es)?|cucumbers?|lettuce|spinach|carrots?|peppers?|zucchini|eggplant|cauliflower|broccoli|parsley|mint|cilantro|butter|labneh|hummus|za'?atar|olives?|dates|flour|sugar|cereal|oats|oatmeal|snacks?|crackers|juice|coffee|tea|paper towels?|toilet paper|tissues|detergent|soap|dish soap|shampoo|toothpaste|pita|tortillas?|beans|lentils|chickpeas|nuts|almonds|honey|jam|peanut butter|ketchup|spices?|salt|frozen|ice cream|popsicles|pumpkins?|squash|corn|vitamins|trash bags|ziploc\w*|foil)\b/i;
const TASKY = /\b(call|clean|fold|carv\w*|cook|make|bake|wash|book|schedule|pay|email|text|fix|plan|prep|return|exchange|patch|picking)\b/i;
// "Kids buy pumpkins", "we carve pumpkins": someone doing something, so a task even with a grocery word in it.
const SUBJECT_VERB = /\b(?:kids?|boys|hamad|talal|yousef|yusuf|omar|we|i)\s+(?:will\s+|can\s+|should\s+)?(?:buy|eat|carve|make|pick|bake|cook|go|bring|try)\b/i;
// Times said without am/pm at the end of an item: "pick up kids 2:30", "Yousef nap 12", "harvest fest 5:30-7".
const BARE_TIME = /(?:\s+(?:at|@))?\s+(\d{1,2})(?::(\d{2}))?(?:\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?)?\s*[?!.]*$/i;
const MONTH_BEFORE = /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?$|\bthe$|\bin$|\bfor$/i;
function bareTime(piece: string): { time: string; rest: string } | null {
  if (/\d\s*[ap]\.?\s*m\b|\bnoon\b|\d\s*\/\s*\d/i.test(piece)) return null;
  const m = BARE_TIME.exec(piece);
  if (!m) return null;
  const before = piece.slice(0, m.index).trim();
  if (!before || MONTH_BEFORE.test(before)) return null;
  const h = Number(m[1]), mi = Number(m[2] || 0);
  if (h < 1 || h > 12 || mi > 59) return null;
  const pm = h === 12 || h <= 6;           // a family day: 7–11 are mornings, 12–6 afternoons and evenings
  return { time: `${h}:${String(mi).padStart(2, "0")} ${pm ? "PM" : "AM"}`, rest: before };
}
const NOTE_LEAD = /^\s*(?:note(?:\s+to\s+self)?|idea|maybe|someday|remember that|fyi|thought)\b[:,]?\s*/i;
const MEDIUM = /\b(medium[\s-]?priority|normal priority|priority two|p ?2)\b/i;
const DEADLINE_WORD = /\b(due|deadline|by|submit)\b/i;

const pretty = (s: string) => s.replace(/’/g, "'");
const key = (s: string) => pretty(s).toLowerCase().replace(/'/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const newId = (p: string) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function storeIn(piece: string, stores: string[]): string | null {
  const k = ` ${key(piece)} `;
  for (const s of stores) if (s !== "Other" && k.includes(` ${key(s)} `)) return s;
  for (const [alias, s] of Object.entries(STORE_ALIASES)) if (k.includes(` ${alias} `)) return s;
  return null;
}

function stripStore(piece: string, store: string): string {
  const words = key(store).split(" ").map((w) => w.replace(/s$/, "s?")).join("['’]?\\s*");
  return piece.replace(new RegExp(`\\s*(?:at|from|to|@|for)?\\s*\\b${words}\\b(?:['’]s)?`, "i"), " ").replace(/\s{2,}/g, " ").trim();
}

function cleanGrocery(piece: string): string[] {
  return piece
    .replace(/^\s*(?:and\s+)?(?:we\s+|i\s+)?(?:need(?:\s+to\s+(?:buy|get))?|buy|get|grab|pick ?up|order|add|more|also)\s+/i, "")
    .replace(/^\s*(?:some|more|a|an)\s+/i, "")
    .replace(/[.,;!]+$/, "")
    .split(/\s+(?:and|&)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);
}

// A piece that only adds detail to the item before it: "high priority", "remind me a week before", "Friday", "at 3".
const MODIFIER = /^(?:and\s+)?(?:it'?s\s+|make it\s+)?(?:(?:high|low|medium|top|normal)[\s-]*priority|urgent|asap|important|not urgent|no rush|whenever|p ?[123])$|^(?:and\s+)?(?:please\s+)?(?:remind me|set (?:up )?(?:a )?reminder|reminder|alert me|ping me)\b|^(?:due|by|on|at|before|until)\b/i;
function isModifier(piece: string, today: string): boolean {
  if (MODIFIER.test(piece)) return true;
  const d = findDate(piece, today);
  if (d && d.index <= 1 && d.length >= piece.replace(/[.!]+$/, "").length - 2) return true;
  return /^(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:[ap]\.?m\.?)?$|^(?:noon|tonight|this (?:morning|afternoon|evening))$/i.test(piece);
}

// "Costco we need milk, yogurt pouches, eggs" -> one sentence, several pieces that share the store.
function splitPieces(sentence: string, today: string): string[] {
  const raw = sentence
    .split(/,(?!\s*20\d{2}\b)|•|\s+-\s+/)
    .map((s) => s.trim().replace(/^[-*\d.)\s]+(?=\D)/, "").trim())
    .filter((s) => s.replace(/[\s.,;!?]/g, "").length > 1);
  const out: string[] = [];
  for (const p of raw) {
    if (out.length && isModifier(p, today)) out[out.length - 1] += `, ${p}`;
    else out.push(p);
  }
  return out;
}

export type FarahItem =
  | { kind: "task"; id: string; title: string; tag: FarahTag; date: string | null; time: string | null; priority: string | null; remindOn: string | null; duplicate?: boolean }
  | { kind: "grocery"; id: string; item: string; store: string; duplicate?: boolean }
  | { kind: "idea"; id: string; text: string };

type Doc = Record<string, unknown>;

export type SortContext = { stores: string[]; projects: Doc[]; openTitles: Set<string>; openGrocery: Set<string> };

// Pure: turns what she said into tagged tasks, grocery items and ideas. No database access, so it is easy to test.
export function sortCapture(text: string, today: string, ctx: SortContext): FarahItem[] {
  const { stores, projects, openTitles, openGrocery } = ctx;
  // "Brain dump Thursday: ..." puts every item on that day unless an item says otherwise.
  let body = text;
  let dumpDate: string | null = null;
  const head = /^\s*brain\s*dump\s*([^:]*):/i.exec(body);
  if (head) {
    dumpDate = (head[1].trim() && findDate(head[1], today)?.date) || today;
    body = body.slice(head[0].length);
  }

  const items: FarahItem[] = [];
  for (const sentence of splitItems(body).slice(0, 20)) {
    let storeCtx: string | null = null;
    let groceryRun = false;
    for (const piece0 of splitPieces(sentence, today).slice(0, 30)) {
      const piece = pretty(piece0);
      if (NOTE_LEAD.test(piece)) {
        const t = cap(piece.replace(NOTE_LEAD, "").trim());
        if (t) items.push({ kind: "idea", id: newId("n"), text: t });
        continue;
      }
      const store = storeIn(piece, stores);
      const rest = store ? key(stripStore(piece, store)).replace(/^(?:go(?:ing)? to|stop at|quick)\s*/, "").replace(/\b(?:run|trip|stop|today|tomorrow)\b/g, "").trim() : null;
      const bare = store !== null && !rest;
      const hasDate = !!findDate(piece, today) || /\b\d{1,2}(?::\d{2})?\s*[ap]\.?m\b/i.test(piece);
      const short = piece.split(/\s+/).length <= 5;
      const grocery = !bare && !TASKY.test(piece) && !SUBJECT_VERB.test(piece) && (GROCERY_WORDS.test(piece) || (groceryRun && !!storeCtx && short && !hasDate && !matchedTag(piece)));
      if (store) storeCtx = store;

      if (grocery) {
        groceryRun = true;
        const where = store || storeCtx || "Other";
        const cleaned = store ? stripStore(piece, store) : piece;
        for (const it of cleanGrocery(cleaned)) {
          const item = cap(it);
          const dup = openGrocery.has(`${where}|${key(item)}`);
          items.push({ kind: "grocery", id: newId("g"), item, store: where, ...(dup ? { duplicate: true } : {}) });
          openGrocery.add(`${where}|${key(item)}`);
        }
        continue;
      }
      if (bare) groceryRun = true;

      const bt = bareTime(piece);
      const [p] = parseCapture(bt ? bt.rest : piece, today, { trips: false, split: false });
      if (!p) continue;
      if (bt && !p.time) p.time = bt.time;
      if (p.kind === "note") { items.push({ kind: "idea", id: newId("n"), text: p.title }); continue; }
      const title = bare ? `${store} run` : p.title;
      if (!title) continue;
      const proj = projects.find((pr) => {
        const words = key(String(pr.name || "")).split(" ").filter((w) => w.length > 3 && !["game", "project", "with", "outing"].includes(w));
        return words.some((w) => ` ${key(piece)} `.includes(` ${w} `));
      });
      const explicitTag = farahTag(piece);
      const tag: FarahTag = bare ? "errands" : proj && explicitTag === "home" && proj.category ? (proj.category as FarahTag) : explicitTag;
      const priority = p.priority === 1 ? "high" : p.priority === 3 ? "low" : MEDIUM.test(piece) ? "medium" : null;
      const dup = openTitles.has(key(title));
      openTitles.add(key(title));
      items.push({
        kind: "task", id: newId("t"), title, tag, date: p.due || dumpDate, time: p.time, priority, remindOn: p.remindOn,
        ...(dup ? { duplicate: true } : {}),
        ...(proj ? { projectId: String(proj.id) } : {}),
        ...(p.due && DEADLINE_WORD.test(piece) ? { due: p.due } : {}),
        said: piece,
      } as FarahItem);
    }
  }
  return items;
}

export async function smartSaveFarah(owner: string, text: string, opts: { tz?: string; source: string; reminderTime?: string }) {
  const db = supabaseAdmin();
  if (!db) return { error: "Sync is not set up", status: 503 } as const;
  const today = localToday(opts.tz || "America/Chicago");

  // What's already on her dashboard: stores, projects, open tasks and grocery (to tag by project and skip repeats).
  const { data: existing, error: readErr } = await db.from(TABLE).select("kind,id,data").eq("owner", owner).in("kind", ["meta", "projects", "tasks", "grocery"]);
  if (readErr) console.error("smart farah read", readErr.message);
  const rows = (existing || []) as { kind: string; id: string; data: Doc }[];
  const meta = rows.find((r) => r.kind === "meta" && r.id === "main")?.data || {};
  const stores = Array.isArray(meta.stores) && (meta.stores as unknown[]).length ? (meta.stores as string[]).slice() : DEFAULT_STORES.slice();
  const projects = rows.filter((r) => r.kind === "projects" && r.data && r.data.status !== "done").map((r) => r.data);
  const openTitles = new Set(rows.filter((r) => r.kind === "tasks" && r.data && r.data.status !== "done").map((r) => key(String(r.data.title || ""))));
  const openGrocery = new Set(rows.filter((r) => r.kind === "grocery" && r.data && !r.data.archived && !r.data.checked).map((r) => `${r.data.store}|${key(String(r.data.item || ""))}`));

  const items = sortCapture(text, today, { stores, projects, openTitles, openGrocery });
  if (!items.length) return { error: "I couldn't find anything to add.", status: 400 } as const;

  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const write: { owner: string; kind: string; id: string; data: Doc; updated_at: string }[] = [];
  const added = { tasks: [] as string[], grocery: [] as string[], notes: [] as string[] };
  for (const it of items) {
    if ("duplicate" in it && it.duplicate) continue;
    if (it.kind === "task") {
      const x = it as FarahItem & { projectId?: string; due?: string; said?: string };
      write.push({ owner, kind: "tasks", id: it.id, updated_at: stamp, data: {
        id: it.id, title: it.title, category: it.tag, projectId: x.projectId || null, date: it.date, time: it.time, duration: null,
        priority: it.priority, ...(x.due ? { due: x.due } : {}), remindOn: it.remindOn, status: "todo", notes: "", said: x.said || "",
        createdAt: now, completedAt: null, source: opts.source, updatedAt: now,
      } });
      added.tasks.push(it.id);
    } else if (it.kind === "grocery") {
      write.push({ owner, kind: "grocery", id: it.id, updated_at: stamp, data: { id: it.id, item: it.item, store: it.store, checked: false, archived: false, quantity: null, notes: "", createdAt: now, updatedAt: now } });
      added.grocery.push(it.id);
    } else {
      write.push({ owner, kind: "notes", id: it.id, updated_at: stamp, data: { id: it.id, text: it.text, projectId: null, createdAt: now, updatedAt: now } });
      added.notes.push(it.id);
    }
  }
  // The voice note itself, marked as sorted, so the dashboard shows "From your voice note: added …" with Undo.
  const dumpId = newId("d");
  write.push({ owner, kind: "dumps", id: dumpId, updated_at: stamp, data: {
    id: dumpId, text, createdAt: now, processed: true, processedAt: now, autoTried: true, autoAdded: added, autoSeen: false, source: opts.source, updatedAt: now,
  } });
  const { error } = await db.from(TABLE).upsert(write, { onConflict: "owner,kind,id" });
  if (error) {
    console.error("smart farah save", error.message);
    return { error: "Couldn't save. Try again.", status: 500 } as const;
  }

  const time = opts.reminderTime || "8:00 AM";
  const tasks = items.filter((i): i is Extract<FarahItem, { kind: "task" }> => i.kind === "task" && !i.duplicate);
  const reminders = tasks.filter((t) => t.remindOn).map((t) => ({ title: t.title, date: t.remindOn as string, when: humanWhen(t.remindOn as string, time) }));

  // A short sentence the Shortcut shows or speaks: "Added: Pick up Talal (Kids, today 2:30 PM); Costco: milk, eggs."
  const fmt = (ymd: string) => (ymd === today ? "today" : new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }));
  const parts: string[] = tasks.map((t) => `${t.title} (${[TAG_LABEL[t.tag], t.priority === "high" ? "high" : "", t.date ? fmt(t.date) : "", t.time || ""].filter(Boolean).join(", ")})`);
  const byStore = new Map<string, string[]>();
  items.forEach((i) => { if (i.kind === "grocery" && !i.duplicate) byStore.set(i.store, [...(byStore.get(i.store) || []), i.item.toLowerCase()]); });
  byStore.forEach((list, s) => parts.push(`${s}: ${list.join(", ")}`));
  const ideas = items.filter((i) => i.kind === "idea").length;
  if (ideas) parts.push(ideas === 1 ? "1 idea" : `${ideas} ideas`);
  const dups = items.filter((i) => "duplicate" in i && i.duplicate).length;
  const remind = reminders.length ? ` Reminder${reminders.length > 1 ? "s" : ""}: ${reminders.map((r) => fmt(r.date)).join(", ")}.` : "";
  const skipped = dups ? ` ${dups} already on your list.` : "";
  const message = parts.length ? `Added: ${parts.join("; ")}.${remind}${skipped}` : `Nothing new.${skipped}`;
  return { items, reminders, message, dumpId };
}
