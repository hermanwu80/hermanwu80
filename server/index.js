import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createAi } from './ai.js';
import { createApp } from './app.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const port = Number(process.env.PORT) || 3000;

const db = openDb(path.join(dataDir, 'budget.db'));
const ai = createAi();
const production = process.env.NODE_ENV === 'production';
const app = createApp({
  db, ai, dataDir,
  // Behind HTTPS (Fly, Render, Railway, Cloudflare Tunnel...) cookies are marked Secure and the proxy's client IP is trusted.
  secureCookies: production && process.env.INSECURE_COOKIES !== '1',
  trustProxy: process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY : production ? 1 : false,
});

app.listen(port, () => {
  console.log('\nWeekly Budget is running.\n');
  console.log(`  On this computer:  http://localhost:${port}`);
  const lan = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal);
  for (const i of lan) console.log(`  On your iPhone (same Wi-Fi):  http://${i.address}:${port}`);
  console.log('');
  console.log(ai.enabled ? `AI: ${ai.model}` : 'AI: disabled (set ANTHROPIC_API_KEY to enable receipt scanning)');
});
