import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { createAi } from '../server/ai.js';

/** Boots the app on a random port against an in-memory db. `client` is a fake Anthropic client (or null). */
export async function boot({ client = null } = {}) {
  const db = openDb(':memory:');
  const ai = createAi({ client });
  const app = createApp({ db, ai });
  const server = await new Promise((res) => { const s = app.listen(0, () => res(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const make = () => {
    let cookie = '';
    const call = async (method, url, body) => {
      const r = await fetch(base + url, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = r.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not json */ }
      return { status: r.status, json, text };
    };
    return { get: (u) => call('GET', u), post: (u, b = {}) => call('POST', u, b), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u) };
  };
  return { db, base, make, close: () => { server.close(); db.close(); } };
}

export const fakeClient = (handler) => ({
  messages: { create: async (params) => handler(params) },
});
