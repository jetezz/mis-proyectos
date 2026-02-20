import type { APIRoute } from 'astro';
import { API_URL } from 'astro:env/server';

/**
 * Proxy server-side para /api/projects → http://api:3000/projects
 *
 * El proxy de Vite (astro.config vite.server.proxy) solo funciona con
 * `astro dev`. En producción SSR con Node standalone hay que usar
 * rutas Astro como este handler.
 */
async function proxyTo(apiPath: string, request: Request): Promise<Response> {
  const targetUrl = `${API_URL}${apiPath}`;

  const headers = new Headers();
  // Pasar el JWT del cliente al backend
  const auth = request.headers.get('Authorization');
  if (auth) headers.set('Authorization', auth);
  headers.set('Content-Type', 'application/json');

  const init: RequestInit = {
    method: request.method,
    headers,
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  try {
    const res = await fetch(targetUrl, init);
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      },
    });
  } catch (err) {
    console.error('[proxy /api/projects]', err);
    return new Response(JSON.stringify({ message: 'API backend unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const GET: APIRoute = ({ request }) => proxyTo('/projects', request);
export const POST: APIRoute = ({ request }) => proxyTo('/projects', request);
