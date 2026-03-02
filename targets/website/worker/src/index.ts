interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN?: string;
}

const corsHeaders = (origin: string) => ({
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || '*';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers });
    }

    try {
      const { email, intent } = await request.json<{
        email: string;
        intent?: string;
      }>();

      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return Response.json({ error: 'Invalid email address' }, { status: 400, headers });
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

      return Response.json({ ok: true }, { headers });
    } catch {
      return Response.json({ error: 'Internal server error' }, { status: 500, headers });
    }
  },
} satisfies ExportedHandler<Env>;
