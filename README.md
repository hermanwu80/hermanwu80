# Weekly Budget

A two-person weekly budgeting app that replaces the paper notebook. It installs on an iPhone's Home Screen (PWA), both of you see the same data, and Claude reads receipts and emails and files them in the right category.

It follows the paper system: one page per week, bills listed on the week they're due, a payday line, and "what's left" at the bottom.

## What it does

- **Week view** – a Sun–Sat page (start day is configurable) with paydays and bills in date order, a budget bar per category, every transaction, and a big **projected left this week** number:
  `income − (spent so far + bills still to pay + unspent weekly budgets)`.
- **Bills & paydays** – set a schedule once (monthly on the 15th, last day of month, twice a month, every other Wednesday, every 3 months…) and they show up in the right weeks. Tap the circle to mark a bill paid; tap the row to change the amount, skip it, or undo it. Unpaid bills **carry forward** into the current week, like the paper list.
- **Scan a receipt / paste an email** – take a photo, pick a screenshot or PDF, or paste an email. Claude pulls out merchant, date, total, category, and which card it was paid with, and matches it to a recurring bill when it clearly is one (the bill is then marked paid). You always review before saving.
- **It learns** – when you correct a category, that merchant is remembered and applied next time.
- **Insights** – 8-week planned-vs-spent chart, spending by category, and an **Ask your budget** chat ("Are we on track this week?").
- **Two people, one budget** – the second person joins with an invite code. Everyone's entries show who made them; the app refreshes when you switch back to it.
- **Export** – all transactions as CSV.

No bank linking: everything is entered by receipt, email, or by hand.

## Run it

```bash
npm install
cp .env.example .env      # add ANTHROPIC_API_KEY
export $(grep -v '^#' .env | xargs)
npm start                 # http://localhost:3000
npm test
```

Requires Node 22.13+. Data is a single SQLite file plus receipt images under `DATA_DIR` (default `./data`) — back that folder up.

The first person to open the app creates the household (and can start from the bills on your paper list). After that, setup is closed; the second person uses **I have an invite code** (code is in **More**).

## Put it on your iPhone

The phones need to reach the server over **HTTPS** (required for Home Screen install and secure login). Any host that runs a container works; you need a small persistent disk mounted at `/data`.

```bash
docker build -t weekly-budget .
docker run -p 3000:3000 -v budget-data:/data -e ANTHROPIC_API_KEY=sk-ant-... weekly-budget
```

Easy options: Fly.io, Railway or Render (add a volume at `/data`), or a home server/Raspberry Pi behind Tailscale Funnel or a Cloudflare Tunnel. In production mode the app assumes one HTTPS proxy in front (`TRUST_PROXY` to change); set `INSECURE_COOKIES=1` only for plain-http testing.

Then on each iPhone: open the URL in **Safari → Share → Add to Home Screen**.

## AI details

- Default model is `claude-opus-5-5`; override with `ANTHROPIC_MODEL` (e.g. `claude-sonnet-5-5` or `claude-haiku-4-5` to spend less). Each receipt is one API call, with reasoning effort set low.
- Photos are downscaled in the browser (max 1600px) before upload. The first image/PDF of a scan is kept with the transaction so you can view the receipt later; unattached uploads are deleted after a day.
- Receipt and email text is treated as untrusted data. The model can only return a structured result, and the server throws away any category/account/bill id that isn't yours, so a malicious email can't do anything but suggest a bad category you'd see in the review screen.
- iOS doesn't let Home Screen apps appear in the Share sheet, so for emails: copy the text and use **Paste an email**, or screenshot it and use **Scan a receipt**.

## Layout

```
server/        Express API + SQLite (node:sqlite), schedule engine, week math, Claude calls
public/        The PWA: vanilla JS modules, no build step
public/js/dates.js   date helpers shared by browser and server
test/          node:test suites (schedules, week math, API, AI validation)
```

## Starter data

The "start from our paper list" option creates the bills, schedules, categories and weekly budgets from the notebook pages (amounts taken from the September pages; unknown ones are left at $0 and flagged **set amount**). Things worth checking in **Plan**: the day-of-month for Haircuts, Ashley meds and Multivitamins; which weekday Childcare and the Cleaner fall on; and the category for "Patrick" and "Nina". Paydays and card balances are not pre-filled — add your paychecks under **Plan → Paydays**.
