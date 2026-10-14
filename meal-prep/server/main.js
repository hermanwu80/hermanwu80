import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createRecipeAi } from './recipes.js';
import { createDemoRecipes } from './demo.js';
import { createPlanner } from './planner.js';
import { createScheduler } from './scheduler.js';
import { createApp } from './app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const port = Number(process.env.PORT) || 3000;
const production = process.env.NODE_ENV === 'production';

const db = openDb(path.join(dataDir, 'meals.db'));
const ai = createRecipeAi();
const recipes = ai.enabled ? ai : createDemoRecipes();
const planner = createPlanner({ db, recipes });
const scheduler = createScheduler({ planner, log: (m) => console.log(m) });
const app = createApp({
  db, planner, recipes,
  password: process.env.APP_PASSWORD || '',
  // Behind HTTPS (Fly, Render, Railway, Cloudflare Tunnel...) cookies are marked Secure and the proxy's client IP is trusted.
  secureCookies: production && process.env.INSECURE_COOKIES !== '1',
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : production ? 1 : false,
});

const server = app.listen(port, () => {
  console.log(`Meal Prep running on http://localhost:${port}`);
  console.log(ai.enabled ? `Recipes: ${ai.model}` : 'Recipes: DEMO MODE (built-in library). Set ANTHROPIC_API_KEY for AI-written recipes.');
  if (process.env.APP_PASSWORD) console.log('Access password: required');
  scheduler.start();
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${port} is already in use. Start on another port, e.g.  PORT=3100 npm start  (then open http://localhost:3100)`);
  else console.error(e.message);
  process.exit(1);
});
