// myday widget for Scriptable (iPhone). Home screen: small, medium, large. Lock screen: inline, rectangular, circular.
// First run inside Scriptable asks for your capture token once and keeps it in the iPhone keychain.
// Setup steps: WIDGETS.md in the repo.

const BASE = "https://myday-orcin.vercel.app";
const KEY = "myday_token";

async function token() {
  if (args.widgetParameter && args.widgetParameter.length > 20) return args.widgetParameter.trim();
  if (Keychain.contains(KEY)) return Keychain.get(KEY);
  if (!config.runsInApp) return null;
  const a = new Alert();
  a.title = "myday widget";
  a.message = "Paste your capture token (the same one your back-tap Shortcut uses). It stays in this iPhone's keychain.";
  a.addSecureTextField("Token", "");
  a.addAction("Save");
  a.addCancelAction("Cancel");
  if ((await a.present()) === -1) return null;
  const t = a.textFieldValue(0).trim();
  if (t) Keychain.set(KEY, t);
  return t || null;
}

async function load(tok) {
  const r = new Request(`${BASE}/api/widget`);
  r.headers = { Authorization: `Bearer ${tok}` };
  r.timeoutInterval = 12;
  try {
    const data = await r.loadJSON();
    if (r.response && r.response.statusCode === 401) return { error: "Token not accepted" };
    Keychain.set("myday_last", JSON.stringify(data));            // shown if the next refresh is offline
    return data;
  } catch (e) {
    return Keychain.contains("myday_last") ? Object.assign(JSON.parse(Keychain.get("myday_last")), { offline: true }) : { error: "Offline" };
  }
}

const ink = Color.dynamic(new Color("#262624"), new Color("#ECEAE4"));
const muted = Color.dynamic(new Color("#6B6A66"), new Color("#A3A19A"));
const bg = Color.dynamic(new Color("#F8F7F4"), new Color("#1F1F1D"));
const serif = (n) => new Font("Georgia-Bold", n);
const sys = (n, bold) => (bold ? Font.semiboldSystemFont(n) : Font.systemFont(n));

function text(stack, s, font, color, lines = 1) {
  const t = stack.addText(String(s || ""));
  t.font = font; t.textColor = color; t.lineLimit = lines; t.minimumScaleFactor = 0.7;
  return t;
}

function build(d, family) {
  const w = new ListWidget();
  w.url = (d && d.url) || `${BASE}/dashboard`;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const lock = family.startsWith("accessory");
  if (!lock) { w.backgroundColor = bg; w.setPadding(14, 14, 14, 14); }

  if (!d || d.error) {
    text(w, d && d.error ? d.error : "Open Scriptable to set up", sys(lock ? 12 : 13, true), lock ? Color.white() : ink, 2);
    return w;
  }
  const next = d.next;
  const nextLine = next ? `${next.when === "now" ? "Now" : next.time} · ${next.title}` : "Nothing else timed";
  const leftLine = d.left ? `${d.left} left${d.needsYou ? ` · ${d.needsYou} need${d.needsYou === 1 ? "s" : ""} you` : ""}` : "All clear";

  if (family === "accessoryInline") { text(w, d.inline, sys(12, true), Color.white()); return w; }

  if (family === "accessoryCircular") {
    w.addAccessoryWidgetBackground = true;
    const s = w.addStack(); s.layoutVertically(); s.centerAlignContent();
    const n = text(s, String(d.left), sys(22, true), Color.white()); n.centerAlignText();
    const l = text(s, "left", sys(10), Color.white()); l.centerAlignText();
    return w;
  }

  if (family === "accessoryRectangular") {
    text(w, next ? (next.when === "now" ? "NOW" : next.when.toUpperCase()) : "TODAY", sys(11, true), Color.white());
    text(w, next ? next.title : leftLine, sys(14, true), Color.white(), 1);
    text(w, next ? leftLine : (d.omar || ""), sys(11), Color.white(), 1);
    return w;
  }

  // Home screen
  const top = w.addStack(); top.centerAlignContent();
  text(top, new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).toUpperCase(), sys(10, true), muted);
  top.addSpacer();
  if (d.weather && d.weather.temp != null) text(top, `${d.weather.icon || ""} ${d.weather.temp}°`, sys(11, true), ink);
  w.addSpacer(6);

  text(w, next ? (next.when === "now" ? "Now" : next.when) : "Next", sys(11), muted);
  text(w, next ? next.title : "Nothing else timed", serif(family === "small" ? 17 : 19), ink, 2);
  if (family !== "small" && d.then && d.then.length) {
    w.addSpacer(6);
    d.then.slice(0, family === "large" ? 3 : 2).forEach((i) => text(w, `${i.time}  ${i.title}`, sys(12), ink, 1));
  }
  w.addSpacer();
  if (family !== "small" && d.omar) text(w, d.omar, sys(11), muted, 1);
  if (family === "large" && d.firstDecision) { w.addSpacer(4); text(w, `Needs you: ${d.firstDecision}`, sys(12, true), ink, 2); }
  if (d.allDay && d.allDay.length && family !== "small") text(w, d.allDay.join(" · "), sys(11), muted, 1);
  text(w, leftLine + (d.offline ? " · offline" : ""), sys(11, true), ink, 1);
  return w;
}

const tok = await token();
const data = tok ? await load(tok) : { error: "Open Scriptable to set up" };
const family = config.widgetFamily || "medium";
const widget = build(data, family);
if (config.runsInWidget) Script.setWidget(widget);
else if (family === "small") await widget.presentSmall();
else if (family === "large") await widget.presentLarge();
else await widget.presentMedium();
Script.complete();
