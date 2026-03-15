interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}

interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatement;
}

interface AssetFetcher {
  fetch(input: Request | string | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  DB: D1DatabaseBinding;
  ASSETS: AssetFetcher;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SubscribePayload = {
  email?: string;
  intent?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

async function handleSubscribe(request: Request, env: Env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        Allow: 'OPTIONS, POST',
      },
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    const { email, intent } = (await request.json()) as SubscribePayload;

    if (!email || !emailPattern.test(email)) {
      return jsonResponse({ error: 'Invalid email address' }, 400);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const source = intent === 'hosted' ? 'waitlist' : 'newsletter';

    await env.DB.prepare(
      `INSERT INTO subscribers (email, source)
       VALUES (?, ?)
       ON CONFLICT (email, source) DO NOTHING`,
    )
      .bind(normalizedEmail, source)
      .run();

    return jsonResponse({ ok: true });
  } catch {
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/subscribe') {
      return handleSubscribe(request, env);
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

export default worker;
