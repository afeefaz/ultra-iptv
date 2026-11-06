// A mailbox for encrypted data (docs/remote-and-sync-plan.md). It stores what it's given under an
// unguessable id until it expires. It can't read any of it, and logs nothing about it.

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface Env {
  DB: { prepare(sql: string): D1Statement };
  LIMITER?: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

// A row can be 2 MB, and a push with lots of watch history is the biggest thing stored.
const MAX_BODY_CHARS = 1_900_000;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 10 * 365 * 24 * 3600;
const DEFAULT_TTL_SECONDS = 15 * 60;
const BOX_PATH = /^\/v1\/box\/([A-Za-z0-9_-]{32,64})$/;

// The apps call this from file:// (Samsung) and http://localhost (Android).
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const respond = (body: string | null, status: number) =>
  new Response(body, { status, headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

const now = () => Math.floor(Date.now() / 1000);

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (url.pathname === '/v1/health' && request.method === 'GET') return respond('ok', 200);

  const match = BOX_PATH.exec(url.pathname);
  if (!match) return respond('not found', 404);
  const id = match[1];

  // Keyed by address only while counting; never stored by us.
  if (env.LIMITER) {
    const { success } = await env.LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
    if (!success) return respond('slow down', 429);
  }

  if (request.method === 'GET') {
    const row = await env.DB.prepare('SELECT body FROM boxes WHERE id = ? AND expires_at > ?').bind(id, now()).first<{ body: string }>();
    return row ? respond(row.body, 200) : respond('empty', 404);
  }
  if (request.method === 'PUT') {
    const body = await request.text();
    if (!body) return respond('empty body', 400);
    if (body.length > MAX_BODY_CHARS) return respond('too large', 413);
    const asked = Number(url.searchParams.get('ttl')) || DEFAULT_TTL_SECONDS;
    const ttl = Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, asked));
    await env.DB.prepare('INSERT OR REPLACE INTO boxes (id, body, expires_at) VALUES (?, ?, ?)').bind(id, body, now() + ttl).run();
    return respond(null, 204);
  }
  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM boxes WHERE id = ?').bind(id).run();
    return respond(null, 204);
  }
  return respond('method not allowed', 405);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      // No details: they could only ever describe this request's data.
      return respond('error', 500);
    }
  },
  async scheduled(_event: unknown, env: Env): Promise<void> {
    await env.DB.prepare('DELETE FROM boxes WHERE expires_at <= ?').bind(now()).run();
  },
};
