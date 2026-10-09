# Store-arrival grocery alerts

When you arrive at Trader Joe's, Target or Costco, your iPhone shows a notification with what's on that store's list.
Your phone handles the location (iOS geofencing); the dashboard only serves the list. No new Vercel env vars: it reuses `CAPTURE_TOKEN` and `CAPTURE_EMAIL`.

## The endpoint

`GET https://myday-orcin.vercel.app/api/grocery?store=<store>`
Header: `Authorization: Bearer <CAPTURE_TOKEN>`

| Store         | `store=`     |
|---------------|--------------|
| Trader Joe's  | `traderjoes` |
| Target        | `target`     |
| Costco        | `costco`     |

Reply (JSON): `count`, `title` (e.g. "At Costco: 3 to get"), `text` (items joined by commas), `items`, `link`.
Only unchecked items are returned. Any other store on the dashboard works the same way (`walmart`, `aldi`).

## iPhone setup (once per store, about 2 minutes each)

1. Shortcuts app → **Automation** → **+** → **Arrive**.
2. **Location** → search the store (e.g. "Costco Rochester") → pick it. Leave the radius at the default or shrink it to the parking lot.
3. Choose **Run Immediately** and turn off **Notify When Run**. Tap **Next** → **New Blank Automation**.
4. Add these actions in order:
   1. **Get Contents of URL** — URL `https://myday-orcin.vercel.app/api/grocery?store=costco`. Expand it: Method **GET**, add Header `Authorization` = `Bearer ` + your CAPTURE_TOKEN (same token as your Brain Dump shortcut).
   2. **Get Dictionary Value** — Key `count` from *Contents of URL*.
   3. **If** *Dictionary Value* **is greater than** `0`:
      - **Get Dictionary Value** — Key `title` from *Contents of URL*.
      - **Get Dictionary Value** — Key `text` from *Contents of URL*.
      - **Show Notification** — Title: the `title` value, Body: the `text` value.
   4. **End If** (added automatically).
5. Repeat for Trader Joe's (`store=traderjoes`) and Target (`store=target`). Quickest: long-press the first automation → **Duplicate**, then change the location and the URL.

If you shop at more than one location of the same store, add one automation per location.

## Opening the list

`https://myday-orcin.vercel.app/dashboard?tab=grocery&store=Costco` opens the Grocery tab with that store expanded.
To jump there from the alert, add **Open URLs** with the `link` value after Show Notification (it opens Safari as soon as you arrive), or leave it out and open the dashboard yourself.

## Test before you leave the house

In the automation, tap the play button. With items on the list you see the notification; with an empty list nothing happens.
A 401 means the token in the header doesn't match `CAPTURE_TOKEN` in Vercel.
