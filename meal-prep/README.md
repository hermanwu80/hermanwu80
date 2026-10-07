# Meal Prep

A daily meal planner that cuts food waste. For every meal it gives you **three full recipes** (ingredients, grocery list, step-by-step instructions); you pick one. What you pick feeds the next day's suggestions, so the bag of apples you buy on Monday shapes Tuesday's and Wednesday's options until it's used up.

Works on a desktop browser today and installs on a phone's Home Screen (PWA) when you host it.

## How it works

1. **Plan a day.** Tap *Get ideas for tomorrow*. Each meal (breakfast, lunch, dinner, optional snack) gets three options. Each option shows its own grocery list, split into what you'd have to **buy** and what you **already have**, plus a `♻️ Uses up: …` badge when it finishes something from earlier meals.
2. **Choose one.** The app then plans the next day automatically, built from your pick. Skip any meal you're eating out.
3. **The cascade.** Every recipe lists ingredients with a realistic package size and shelf life ("bag of 6 apples, 28 days"). The server walks your chosen meals in date order, takes ingredients from stock first, and buys whole packages only when stock runs out. Leftovers that are still good and not already claimed by a later meal become the *use-it-up* list that the next suggestions are asked to build around (soonest expiry first).
4. **One grocery list.** The *Groceries* tab consolidates everything you chose: one bag of apples, not three, grouped by aisle, with "uses 2 of 6, 4 left over, best by Oct 13". Items check off on your device; "Check your pantry" lists the staples (oil, salt, spices) the recipes assume.
5. **When you plan** (Settings):
   - **Manual**: plan whenever you open the app.
   - **Every day** at a time you choose, the day *N* days ahead (1 to 7) is prepared so the ideas are waiting when you open the app.
   - **Weekly** on a weekday at a time you choose, a 7-day plan is started. Day 1 is prepared on schedule; each following day is prepared as you finish the one before it, because each day is built from your earlier picks.
6. **What's on hand** (Settings): list things you already own ("half a bag of spinach, best by Friday") and the suggestions are built to use them.

## Run it

```bash
cd meal-prep
npm install
npm start                 # http://localhost:3000
npm test
```

Requires Node 22.13+. With no API key it runs in **demo mode** using a small built-in recipe library (19 recipes that share ingredients, so you can see the cascade). For fresh, AI-written recipes:

```bash
cp .env.example .env      # add ANTHROPIC_API_KEY
export $(grep -v '^#' .env | xargs)
npm start
```

Data is a single SQLite file under `DATA_DIR` (default `./data`). Automatic planning runs inside the server process, so it only happens while the server is running; if it was off at the scheduled time, it catches up the next time it starts.

## Put it on your phone

Phones need the server reachable over **HTTPS** to install it. Any container host works (Fly.io, Railway, Render, or a home server behind Tailscale Funnel / a Cloudflare Tunnel), with a small persistent disk at `/data`:

```bash
docker build -t meal-prep .
docker run -p 3000:3000 -v mealprep-data:/data -e ANTHROPIC_API_KEY=sk-ant-... -e APP_PASSWORD=choose-one meal-prep
```

Set **`APP_PASSWORD`** before exposing it to the internet: every "get ideas" tap spends API credit, so the app asks for the password first. On the phone: open the URL in Safari, **Share → Add to Home Screen**.

## AI details

- Default model is `claude-opus-5-5` with low reasoning effort; set `ANTHROPIC_MODEL` to trade quality for speed/cost (e.g. `claude-sonnet-5-5`, `claude-haiku-4-5`). One call per meal; a day's three meals run in parallel and take roughly 20 to 40 seconds.
- Output is constrained with a JSON schema, then **sanitised server-side** (units, amounts, package sizes, shelf lives are clamped; unusable ingredients become "check your pantry" items). The server, not the model, decides which options really use up leftovers.
- Diet notes, dislikes, hints and on-hand names are passed as data; they cannot change the app's rules.
- Generation runs as a background job and the app polls, so a phone that sleeps mid-request doesn't lose the result.

## Layout

```
server/cascade.js    the cascade: stock simulation, use-it-up context, consolidated grocery list (pure functions)
server/recipes.js    schema, prompt, sanitiser and Claude call
server/demo.js       built-in recipe library used without an API key
server/planner.js    ties choices, cascade and recipe source together; builds the UI state
server/scheduler.js  daily / weekly automatic planning
server/app.js        Express API (optional password gate)
public/              the PWA: vanilla JS modules, no build step
test/                node:test suites (cascade math, API, AI sanitising, scheduler)
```

## Roadmap

The data model is already shaped for these:

- **Pantry & fridge management**: the `pantry` table and the stock simulation exist; next is marking groceries as bought, decrementing as meals are cooked, and a pantry screen.
- **Expiry reminders**: every lot already carries a best-by date (from shelf life); add a timer view and notifications (Web Push needs HTTPS hosting).
- **Ripeness checklist**: per-ingredient "how to tell it's ripe" cards (optional), shown alongside expiry reminders.
- **Faster week planning**: speculatively prepare the next day while you're still choosing, then discard if your picks differ.
- **Shopping day awareness**: group the list into trips and buy delicate produce later in the week.
