# Farah's back-tap capture: smart tags

Voice notes from Farah's back-tap Shortcut are now sorted the moment they arrive, the same way Omar's are.
No review step: each item lands on /dashboard already tagged, and the Shortcut shows what was added.

## What the filter does

- **Tags** every task: Kids, Work, Home, Errands, Self, Activity, Omar.
  - Omar: mentions Omar ("Omar dentist Tuesday 4pm")
  - Kids: Hamad, Talal, Yousef, kids, school, daycare, pediatrician, nap, bath, homework…
  - Work: WorkWave, work, portfolio, resume, interview, meeting, Figma, deck, course…
  - Self: gym, yoga, walk, haircut, nails, dentist, doctor, read, pray, quilt, sewing…
  - Activity: park, library, zoo, outing, pumpkin patch, carving, stroll, festival…
  - Errands: buy, pick up, drop off, return, pharmacy, post office, bank, store runs, call, pay, renew…
  - Home: everything else (laundry, cleaning, dinner, cooking…)
  - A task that matches one of your projects is linked to it.
- **Grocery**: food and household items go to the Grocery tab under the store you named
  ("Costco we need milk, yogurt pouches, ground beef"). No store named → Other.
  A store on its own ("Trader Joe's") becomes an errand: "Trader Joe's run".
- **Ideas**: start with "Idea:" or "Note:".
- **Dates and times**: "tomorrow", "Friday", "Oct 20", "in two weeks", "at 4pm", and plain "2:30" or "nap 12"
  (7–11 are read as morning, 12–6 as afternoon). "Brain dump Thursday: …" puts everything on Thursday.
- **Priority**: "high priority", "urgent", "asap" → High; "low priority", "whenever" → Low. Deadlines ("due", "submit") → High.
- **Reminders**: "remind me a week before", "remind me 2 days before", "remind me on Oct 12".
- Items already on your list are skipped, not doubled.

On the dashboard, a card says "From your voice note: added …" with **Undo**, which takes it all back off and
leaves the note in "Brain dumps to sort". If nothing recognisable was said, the note goes there too.

## Shortcut (Farah's phone)

Your existing shortcut keeps working; the reply now says what was added. To also get iPhone reminders,
make it match Omar's:

1. **Dictate Text** (Stop listening: After Pause)
2. **Get Contents of URL**
   - URL: `https://myday-orcin.vercel.app/api/capture`
   - Method: POST
   - Headers: `Authorization` = `Bearer <CAPTURE_TOKEN>`
   - Request Body: JSON → `text` = *Dictated Text*
3. **Get Dictionary Value** → `reminders` from *Contents of URL*
4. **Repeat with Each** item in *Dictionary Value*:
   - **Get Dictionary Value** `title` from *Repeat Item* → **Get Dictionary Value** `when` from *Repeat Item*
   - **Add New Reminder** with title = the title value, **Remind Me** on, date = the `when` value
5. After the repeat: **Get Dictionary Value** `message` → **Show Notification**

Settings → Accessibility → Touch → Back Tap → Double Tap → your capture shortcut.

Optional env var: `FARAH_REMINDER_TIME` (time on those reminders, default `8:00 AM`).

## Try saying

- "Call the pediatrician tomorrow, high priority. Return shoes to Target. Gym at 6 am."
- "WorkWave onboarding forms due October 20, remind me a week before."
- "Costco we need Talal milk, yogurt pouches, ground beef, strawberries."
- "Pick up kids from school 2:30, Yousef nap 12, fold laundry, Omar dentist Tuesday at 4pm."
- "Idea: quilt squares from Yousef's onesies."
