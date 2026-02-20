import type { APIRoute } from 'astro';
import { API_URL } from 'astro:env/server';

async function proxyTo(apiPath: string, request: Request): Promise<Response> {
  const targetUrl = `${API_URL}${apiPath}`;

  const headers = new Headers();
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
    console.error(`[proxy ${apiPath}]`, err);
    return new Response(JSON.stringify({ message: 'API backend unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

export const GET: APIRoute = ({ request }) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');
  return proxyTo(`/opencode-files?projectId=${encodeURIComponent(projectId || '')}`, request);
};

export const POST: APIRoute = ({ request }) => proxyTo('/opencode-files', request);

export const DELETE: APIRoute = ({ request }) => proxyTo('/opencode-files', request);
