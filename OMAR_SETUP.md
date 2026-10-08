# Omar's dashboard — setup

Omar gets his own page at **/omar**. Same app, same Supabase table, fully separate data: every row is keyed by the signed-in Google email, so Farah and Omar never see each other's tasks, trips, notes or phone calendars. Farah's dashboard is unchanged.

## 1. Vercel environment variables (Settings → Environment Variables)

| Name | Value |
| --- | --- |
| `OMAR_EMAIL` | The personal Google account Omar signs in with (e.g. `omar.something@gmail.com`) |
| `CAPTURE_TOKEN_OMAR` | A long random secret for his voice shortcut. Make one with `openssl rand -hex 24` |
| `ICLOUD_CALENDAR_URLS_OMAR` | Optional. His iPhone calendars' public links (comma separated), same format as Farah's `ICLOUD_CALENDAR_URLS` |
| `OMAR_REMINDER_TIME` | Optional. Time on the iPhone reminders the shortcut creates. Default `8:00 AM` |

Farah's existing `ICLOUD_CALENDAR_URLS`, `CAPTURE_TOKEN` and `CAPTURE_EMAIL` stay as they are and are only ever used for Farah.

## 2. Google sign-in

Google Cloud Console → APIs & Services → OAuth consent screen → **Test users** → add Omar's Google email. He signs in at the app's home page and lands on /omar automatically.

His Google Calendar loads from his own sign-in. His Mayo work calendar can't be connected (Mayo blocks it), so travel shows up from his personal Google Calendar, his iPhone calendars, or what he says.

## 3. iPhone calendar (optional)

iPhone Calendar app → Calendars → ⓘ next to a calendar → **Public Calendar** on → Share Link → copy. Put the links in `ICLOUD_CALENDAR_URLS_OMAR`.

## 4. Back-tap voice shortcut (Omar's phone)

Shortcuts app → + → name it "Omar capture":

1. **Dictate Text** (Stop listening: After Pause)
2. **Get Contents of URL**
   - URL: `https://myday-orcin.vercel.app/api/capture`
   - Method: POST
   - Headers: `Authorization` = `Bearer <CAPTURE_TOKEN_OMAR>`
   - Request Body: JSON → `text` = *Dictated Text*
3. **Get Dictionary Value** → `reminders` from *Contents of URL*
4. **Repeat with Each** item in *Dictionary Value*:
   - **Get Dictionary Value** `title` from *Repeat Item* → **Get Dictionary Value** `when` from *Repeat Item*
   - **Add New Reminder** with title = the title value, **Remind Me** on, date = the `when` value
5. After the repeat: **Get Dictionary Value** `message` → **Show Notification** (or **Speak Text**)

Then Settings → Accessibility → Touch → Back Tap → Double Tap → **Omar capture**.

Things he can say (one item per sentence):
- "Presentation on October 15th, high priority. Remind me a week before."
- "Flying to Lisbon October 20 to 24."
- "Submit the grant report by Friday."
- "Renew license end of month, low priority."
- "Note: parking code is 4412."

The filter is free and rule based: it picks out priority (high/urgent → P1, low/whenever → P3; deadlines, presentations and submissions default to P1), due dates ("Oct 15", "Friday", "in two weeks", "end of month"), times, trips (travel words + a place) and reminders ("a week before", "3 days before", "on Oct 12"). If a "before" date has already passed, the reminder is set for today.

## 5. Phone notifications from the page (optional)

On Omar's iPhone: open /omar in Safari → Share → Add to Home Screen → open it from the icon → **Phone reminders → Turn on**. Each morning (default 7:00) he gets his high priorities, plus any "week before" reminders due that day; the evening before a due date he gets "Due tomorrow".
