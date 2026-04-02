import type { APIRoute } from 'astro';

interface SubscribePayload {
  email?: string;
  intent?: string;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Dev-mode mock for the Cloudflare Worker subscribe endpoint.
 * In production, `/api/subscribe` is handled by the Worker (src/worker.ts).
 * This route prevents 404s during local development and allows testing the form flow.
 */
export const POST: APIRoute = async ({ request }) => {
  let payload: SubscribePayload;

  try {
    payload = (await request.json()) as SubscribePayload;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const trimmedEmail = payload.email?.trim();

  if (!trimmedEmail || !emailPattern.test(trimmedEmail)) {
    return new Response(JSON.stringify({ error: 'Invalid email address' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Mock success -- no database in local dev
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

export const ALL: APIRoute = () => {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST' },
  });
};
