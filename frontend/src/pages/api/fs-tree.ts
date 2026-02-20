import type { APIRoute } from 'astro';
import { API_URL } from 'astro:env/server';

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const projectId = url.searchParams.get('projectId');

  const headers = new Headers();
  const auth = request.headers.get('Authorization');
  if (auth) headers.set('Authorization', auth);
  headers.set('Content-Type', 'application/json');

  try {
    const res = await fetch(`${API_URL}/fs-tree?projectId=${encodeURIComponent(projectId || '')}`, { headers });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'Content-Type': res.headers.get('Content-Type') ?? 'application/json',
      },
    });
  } catch (err) {
    console.error('[proxy /api/fs-tree]', err);
    return new Response(JSON.stringify({ message: 'API backend unreachable' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
