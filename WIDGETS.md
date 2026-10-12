# Home and lock screen widgets

What's next, what's left, Omar's day and the weather, on the iPhone home screen and lock screen.
Tapping a widget opens the dashboard.

iPhone web apps can't draw widgets on their own, so these run in **Scriptable** (free, App Store).
No new service, account or key: the widget reads `/api/widget` with the same capture token your back-tap Shortcut uses.

## What each size shows

| Where | Size | Shows |
| --- | --- | --- |
| Lock screen | Inline (above the clock) | `2:30 PM School pickup · 4 left` |
| Lock screen | Rectangular | When, the next thing, then "4 left · 2 need you" |
| Lock screen | Circular | Tasks left today |
| Home screen | Small | Date, weather, what's next, how many left |
| Home screen | Medium | Plus the next two after it and Omar's line |
| Home screen | Large | Plus no-school days and the first decision waiting for you |

## Setup (about 3 minutes)

1. Install **Scriptable** from the App Store.
2. In Safari, open `https://myday-orcin.vercel.app/widget/myday-widget.js`, select all, copy.
3. In Scriptable, tap **+**, paste, and rename the script **myday** (tap the title at the top).
4. Tap ▶︎ once. Paste your capture token when asked (Vercel → myday → Settings → Environment Variables → `CAPTURE_TOKEN`).
   It's saved in the iPhone keychain. A medium preview appears.
5. **Home screen:** long-press → Edit → Add Widget → Scriptable → pick a size → Add.
   Long-press the new widget → Edit Widget → Script: **myday**. Leave Parameter empty.
6. **Lock screen:** long-press the lock screen → Customize → Lock Screen → tap the widget row (or the date line for inline)
   → Scriptable → pick a shape → tap it → Script: **myday**.

## Capture from the lock screen

Two ways, both using the same sorting rules as the dashboard.

- **Add widget (tap to type):** add another Scriptable widget (circular or rectangular on the lock screen, or small on the
  home screen), choose the **myday** script, and set **Parameter** to `add`. Tapping it opens the dashboard with the
  Add box ready. Medium and large widgets also have a "＋ Add" line.
- **Lock screen button (speak it):** iOS 18 → long-press the lock screen → Customize → Lock Screen →
  tap the bottom-left or bottom-right button → choose **Shortcut** → pick your existing **back-tap capture** Shortcut.
  Press it, say the brain dump, done (iOS may ask you to unlock first). It posts to /api/capture like back-tap does, so items arrive sorted with Undo on the dashboard.
  The Action Button (iPhone 15 Pro and later) can run the same Shortcut.

## How fresh it is

- Tasks are read live from Supabase each refresh, so a task ticked on any device is reflected.
- Calendar, Omar's day, weather and decisions come from a snapshot the dashboard saves whenever it's open
  (at most once a minute, and only when something changed). The snapshot covers today and tomorrow,
  so last night's snapshot still knows today's calendar.
- iOS decides how often widgets refresh, usually every 15 to 30 minutes. If the phone is offline, the last answer
  stays up with "offline".

## For later

- `GET /api/widget?format=text` returns the inline line only, handy for a Shortcut or a Siri reply.
- Code: `app/api/widget/route.ts` (endpoint), `public/widget/myday-widget.js` (Scriptable script),
  `widgetSnapshot()` in `public/dashboard.html` (what the dashboard saves).
