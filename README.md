# Lead Outreach Dashboard

Internal, single-user tool for selling the **Trial-to-Member System** ($500) and the **Follow-up Add-on** ($250-300) to owner-run boutique gyms. Plain HTML + Tailwind (CDN) + vanilla JS on the front, Vercel serverless functions + Google Sheets on the back. No build step, no auth.

## Setup (≈10 minutes)

### 1. Google Sheet
1. Create a new Google Sheet. Copy its **ID** from the URL: `https://docs.google.com/spreadsheets/d/<THIS_PART>/edit`.
2. Leave it empty. On first load the app creates the tabs **Leads** and **Activity** and writes the header rows itself (if you already have a `Leads` tab with 19 or 20 of the columns, it just adds the missing headers at the end — Package in T, Facebook Link in U).

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
| **DM Queue** | Today's DMs split over your two accounts: each account's list holds the ready leads assigned to it (up to its 10 slots; leads with no account yet fill what's left). Each entry has the DM text, Instagram/Facebook buttons, **Copy** and **Mark sent · Account N**. When an account reaches 10/10 its list is replaced by "done for today". Tick *Include leads that aren't ready yet* to fill slots with leads still warming. |
| **Warming** | Leads you're engaging with before any DM. **+1 Touch** counts a real comment; **Preview DM 1** shows the opening message without changing anything; **Send DM 1** sets Status = DM Sent. "Ready for DM 1" appears at 3+ touches and 2+ days. |
| **Follow-ups** | Everyone whose DM 1 went out with no reply: due ones on top, the rest with a "next follow-up in N days" countdown. |
| **Replies** | Replied / Audit Sent / Price Sent leads. **Log Reply** gives the next message to send. |
| **All leads** | Full list with City / Priority / Status filters and sort by last contact. Tap a row for all 20 fields. |
| **Scripts** | Every message template (DM 1 variants, follow-ups, reply scripts, Loom script) with Copy buttons. |

The search box (right of the tabs) filters by gym, city, owner or notes. The DM counter and deadline stay visible on every tab.

## Small things that save time
- **Undo:** after +1 Touch, Send DM 1, Mark sent, Mark Lost or Log Reply, the toast has an **Undo** button (8 seconds). It restores the Sheet cells and cancels the log rows, so the DM counter and follow-up stage roll back too.
- **Copy** turns into "Copied" on the button itself, so you can see it worked even if you miss the toast.
- **Show more:** long lists load 12 cards or 20 rows at a time.
- **Keyboard:** `/` jumps to search, `Esc` closes a dialog, `Enter` opens a lead row, `Tab` stays inside dialogs.
- **Add another:** the toast after adding a lead has an "Add another" button.

## Design notes
Internal work tool, so the look is calm and dense: neutral zinc surfaces, **one** accent (emerald), blue and orange used only to tell Account 1 from Account 2, one radius scale (6px tags, 8px controls, 12px containers), no gradients, no glow, no decorative dots. Light and dark follow the phone or computer setting; both are tested. Text is Geist and Geist Mono, self-hosted in `public/fonts` (no Google Fonts request). Icons are Phosphor (regular weight), generated into `public/icons.js`.

Change an icon or update the fonts:
```bash
npm install
npm run build:assets      # copies the fonts, regenerates public/icons.js from the icon list in scripts/build-assets.js
```

## How it works

**Sheet tab `Leads`** — 21 columns, in order: Gym Name, City, Instagram Link, Followers, Last Post Date, Owner Name, Website Link, Website Quality, Bio Link Type, Has Booking Form, Has Follow-up Automation, Current Offer, Problem, Priority, Status, Last Contact Date, Notes, Engagement Started, Engagement Touches, **Package** (`Trial-to-Member System` | `Follow-up Add-on` | `Skip`), **Facebook Link** (column U, shown as a Facebook button beside the Instagram one) and **DM Account** (column V: which of your two accounts the lead belongs to and sends from — `Account 1` or `Account 2`, filled in blocks of 10 in Sheet order: rows 1-10 → Account 1, 11-20 → Account 2, 21-30 → Account 1 …; a lead added later continues the pattern; change it any time in the lead's detail). Every card shows it as a coloured flag at the top. New columns go last, so older sheets just get extra headers. Dates are stored as `YYYY-MM-DD` text. Edit cells in the Sheet freely, then hit **Refresh**; don't insert/delete/sort rows while the page is open (a write to a row that no longer matches is refused and nothing is written).

**Sheet tab `Activity`** — an append-only log (Timestamp, Date, Gym, City, Event, Detail). The app needs it for two things the 20 columns can't express: the exact **"DMs sent today"** count (a lead DM'd and replied-to on the same day still counts) and **which follow-up stage** (Day 3/6/10) a lead is on — follow-ups are timed from DM 1, not from the last follow-up. If you set a lead to `DM Sent` by hand in the Sheet, the app falls back to its Last Contact date. Don't delete this tab.

**Package** is auto-filled when adding a lead (None/Outdated site → Trial-to-Member System; Modern + booking form + no follow-up → Follow-up Add-on; Modern + Mindbody/Glofox/Wodify in notes → Skip) and can be overridden on the form or later in the expanded row. The reply handler uses it to pick the price message. DM 1 never mentions a product.

**Daily cap**: 10 DMs per account, 20 a day. The header shows both accounts (6/10, 0/10); the total turns amber at 17 and red at 20, and sending past an account's 10 asks for confirmation.

## Tests
```bash
npm test                      # templates, rules, due-today and queue logic, API + Sheet layer (in-memory fake Sheet)
```
Browser checks need Chromium and `playwright-core` (`npm i -D playwright-core` or point `CHROMIUM_PATH` at an installed Chrome):
```bash
node test/ui-smoke.js         # drives the real UI: every tab, the reply handler, add lead, the 10/10 DM queue
node test/ui-audit.js         # design rules as checks: no em dashes in UI copy, contrast >= 4.5 in light AND dark,
                              # one radius scale, no wrapping buttons, undo, focus handling, reduced motion
```
If the Tailwind CDN is unreachable (CI or a sandbox), set `TW_CSS=/path/to/built.css` to inject equivalent styles.
`npm test` can't talk to real Google. Use **Test Sheet** after deploying for that.
