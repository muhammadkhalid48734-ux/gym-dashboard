# Lead Outreach Dashboard

Internal, single-user tool for selling the **Trial-to-Member System** ($500) and the **Follow-up Add-on** ($250-300) to owner-run boutique gyms. Plain HTML + Tailwind (CDN) + vanilla JS on the front, Vercel serverless functions + Google Sheets on the back. No build step, no auth.

## Setup (≈10 minutes)

### 1. Google Sheet
1. Create a new Google Sheet. Copy its **ID** from the URL: `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`.
2. Leave it empty. On first load the app creates the tabs **Leads** and **Activity** and writes the header rows itself (if you already have a `Leads` tab with the 19 original columns, it just adds the `Package` header in column T).

### 2. Service account
1. [console.cloud.google.com](https://console.cloud.google.com) → create/select a project.
2. **APIs & Services → Library →** enable **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create service account** (no roles needed).
4. Open it → **Keys → Add key → Create new key → JSON**. A file downloads.
5. In that JSON you need two values: `client_email` and `private_key`.
6. **Share the Sheet** with the `client_email` address as **Editor** (the Share button in Sheets, like inviting a person). Without this you get "permission denied".

### 3. Deploy to Vercel
1. Push this repo to GitHub, then on [vercel.com](https://vercel.com) → **Add New → Project** → import it. Framework preset: **Other**. Leave build settings empty.
2. **Settings → Environment Variables** (Production + Preview + Development):

   | Name | Value |
   |---|---|
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` from the JSON |
   | `GOOGLE_PRIVATE_KEY` | `private_key` from the JSON, pasted as it is. The code tolerates literal `\n`, real newlines, spaces instead of newlines, wrapping quotes, a trailing comma, or the whole JSON file. If the key is still unusable, the error says what is wrong (empty / cut off / body too short). |
   | `GOOGLE_SHEET_ID` | the Sheet ID from step 1 |

3. **Deploy** (or Redeploy after adding the variables).
4. Open `https://<your-app>.vercel.app/` and press **Test Sheet** (or visit `/api/test`). All four steps should be green: env vars → connect/headers → read → write + read back. Any red step says what to fix.

CLI alternative: `npm i -g vercel && vercel` then `vercel env add …` for the three variables, `vercel --prod`.

### Run locally
```bash
npm install
cp .env.example .env.local     # fill in the three values
npx vercel dev                 # http://localhost:3000
```
No credentials handy? `SEED=1 npm run dev:mock` serves the UI on an in-memory fake Sheet with sample leads.

## Heads-up: it has no login
As specified, there is no auth. Anyone who has the URL can read and write your leads. Keep the URL private and consider switching on **Vercel → Settings → Deployment Protection** for the project.

## Using it (the menu bar)
The bar under the header switches between views. The badge on each tab is a live count.

| Tab | What's in it |
|---|---|
| **Today** | Everything due right now, split into three sub-tabs: **Warm-up** (touches), **Follow-ups** (Day 3 / 6 / 10, or Mark Lost after Day 10) and **Price sent** (quiet for 3+ days). Each entry has the message, a big **Copy** button and **Mark Sent**. |
| **Warming** | Leads you're engaging with before any DM. **+1 Touch** counts a real comment; **Preview DM 1** shows the opening message without changing anything; **Send DM 1** sets Status = DM Sent. "Ready for DM 1" appears at 3+ touches and 2+ days. |
| **Follow-ups** | Everyone whose DM 1 went out with no reply: due ones on top, the rest with a "next follow-up in N days" countdown. |
| **Replies** | Replied / Audit Sent / Price Sent leads. **Log Reply** gives the next message to send. |
| **All leads** | Full list with City / Priority / Status filters and sort by last contact. Tap a row for all 20 fields. |
| **Scripts** | Every message template (DM 1 variants, follow-ups, reply scripts, Loom script) with Copy buttons. |

The search box (right of the tabs) filters by gym, city, owner or notes. The DM counter and deadline stay visible on every tab.

## How it works

**Sheet tab `Leads`** — 20 columns, in order: Gym Name, City, Instagram Link, Followers, Last Post Date, Owner Name, Website Link, Website Quality, Bio Link Type, Has Booking Form, Has Follow-up Automation, Current Offer, Problem, Priority, Status, Last Contact Date, Notes, Engagement Started, Engagement Touches, **Package** (`Trial-to-Member System` | `Follow-up Add-on` | `Skip`). Dates are stored as `YYYY-MM-DD` text. Edit cells in the Sheet freely, then hit **Refresh**; don't insert/delete/sort rows while the page is open (a write to a row that no longer matches is refused and nothing is written).

**Sheet tab `Activity`** — an append-only log (Timestamp, Date, Gym, City, Event, Detail). The app needs it for two things the 20 columns can't express: the exact **"DMs sent today"** count (a lead DM'd and replied-to on the same day still counts) and **which follow-up stage** (Day 3/6/10) a lead is on — follow-ups are timed from DM 1, not from the last follow-up. If you set a lead to `DM Sent` by hand in the Sheet, the app falls back to its Last Contact date. Don't delete this tab.

**Package** is auto-filled when adding a lead (None/Outdated site → Trial-to-Member System; Modern + booking form + no follow-up → Follow-up Add-on; Modern + Mindbody/Glofox/Wodify in notes → Skip) and can be overridden on the form or later in the expanded row. The reply handler uses it to pick the price message. DM 1 never mentions a product.

**Daily cap**: 20 DMs/day. The header turns amber at 17, red at 20, and "Send DM 1" asks for confirmation once you're at 20.

## Tests
```bash
npm test                      # templates, rules, due-today logic, API + Sheet layer (in-memory fake Sheet)
node test/ui-smoke.js         # optional: drives the real UI in Chromium (needs playwright-core)
```
`npm test` can't talk to real Google — use **Test Sheet** after deploying for that.
