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

type RequestCf = {
  city?: string;
  continent?: string;
  country?: string;
  region?: string;
  regionCode?: string;
  timezone?: string;
  colo?: string;
};

type CloudflareRequest = Request & {
  cf?: RequestCf;
};

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

function readColoHeader(request: Request) {
  const cfRay = request.headers.get('CF-Ray');

  if (!cfRay) return null;

  const rayParts = cfRay.split('-');

  return rayParts[1] ?? null;
}

function readSignupMetadata(request: CloudflareRequest) {
  const { cf } = request;

  return {
    ipAddress: request.headers.get('CF-Connecting-IP'),
    userAgent: request.headers.get('User-Agent'),
    referer: request.headers.get('Referer'),
    country: request.headers.get('CF-IPCountry') ?? cf?.country ?? null,
    city: cf?.city ?? null,
    region: cf?.region ?? null,
    regionCode: cf?.regionCode ?? null,
    continent: cf?.continent ?? null,
    timezone: cf?.timezone ?? null,
    colo: cf?.colo ?? readColoHeader(request),
  };
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

  let payload: SubscribePayload;

  try {
    payload = (await request.json()) as SubscribePayload;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { email, intent } = payload;
  const metadata = readSignupMetadata(request as CloudflareRequest);
  const trimmedEmail = email?.trim();

  if (!trimmedEmail || !emailPattern.test(trimmedEmail)) {
    return jsonResponse({ error: 'Invalid email address' }, 400);
  }

  const normalizedEmail = trimmedEmail.toLowerCase();
  const source = intent === 'hosted' ? 'waitlist' : 'newsletter';

  try {
    await env.DB.prepare(
      `INSERT INTO subscribers (
         email,
         source,
         ip_address,
         user_agent,
         country,
         city,
         region,
         region_code,
         continent,
         timezone,
         colo,
         referer
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (email, source) DO NOTHING`,
    )
      .bind(
        normalizedEmail,
        source,
        metadata.ipAddress,
        metadata.userAgent,
        metadata.country,
        metadata.city,
        metadata.region,
        metadata.regionCode,
        metadata.continent,
        metadata.timezone,
        metadata.colo,
        metadata.referer,
      )
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
