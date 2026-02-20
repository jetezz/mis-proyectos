import type { APIRoute } from 'astro';
import { API_URL } from 'astro:env/server';

/**
 * Proxy para POST /api/agent/run → http://api:3000/agent/run
 *
 * Este endpoint devuelve un stream SSE — hay que hacer pipe del body
 * directamente sin leerlo todo en memoria.
 */
export const POST: APIRoute = async ({ request }) => {
  const targetUrl = `${API_URL}/agent/run`;

  const headers = new Headers();
  const auth = request.headers.get('Authorization');
  if (auth) headers.set('Authorization', auth);
  headers.set('Content-Type', 'application/json');

  const body = await request.text();

  try {
    const res = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body,
    });

    if (!res.ok) {
      const errBody = await res.text();
      return new Response(errBody, {
        status: res.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Hacer pipe del SSE stream directamente al cliente sin buffering
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err) {
    console.error('[proxy /api/agent/run]', err);
    return new Response(JSON.stringify({ message: 'Sandbox unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
