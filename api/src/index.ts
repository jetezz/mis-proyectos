import { verifyToken } from './auth';
import { listProjects, createProject, deleteProject, updateProject, assertProjectOwner } from './routes/projects';

import { runAgent } from './routes/agent';

const PORT = parseInt(process.env.PORT || '3000', 10);
const SANDBOX_URL = process.env.SANDBOX_URL || 'http://sandbox:4000';
// WS URL del sandbox (reemplazar http por ws)
const SANDBOX_WS_URL = SANDBOX_URL.replace(/^http/, 'ws');

// ── Rate limiter ─────────────────────────────────────────────────
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW = 60 * 1000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// ── CORS ─────────────────────────────────────────────────────────
const FRONTEND_ORIGIN = process.env.FRONTEND_URL || 'http://frontend:4321';

function corsHeaders(origin: string | null) {
  const allowed = origin === FRONTEND_ORIGIN || process.env.NODE_ENV === 'development';
  return {
    'Access-Control-Allow-Origin': allowed ? (origin ?? '*') : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}


function addCors(res: Response, cors: Record<string, string>): Response {
  const newHeaders = new Headers(res.headers);
  for (const [key, value] of Object.entries(cors)) newHeaders.set(key, value);
  // Security headers for tunnel/public domain
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
}

// ── WebSocket session data ────────────────────────────────────────
interface TerminalSession {
  projectId: string;
  userId: string;
  sandboxWs: WebSocket | null;
  pendingMessages: (string | ArrayBuffer | Uint8Array)[];
}

// ── Server (HTTP + WebSocket) ─────────────────────────────────────
const server = Bun.serve<TerminalSession>({
  port: PORT,
  hostname: '0.0.0.0',

  async fetch(req, server) {
    const url = new URL(req.url);
    const method = req.method.toUpperCase();
    const origin = req.headers.get('origin');
    const cors = corsHeaders(origin);

    // ── WebSocket upgrade para terminal ──────────────────────────
    if (url.pathname === '/terminal') {
      // Auth: JWT como query param (estándar para WebSocket — no se pueden usar headers)
      const token = url.searchParams.get('token');
      const projectId = url.searchParams.get('projectId');

      if (!token || !projectId) {
        return Response.json({ message: 'Missing token or projectId' }, { status: 400 });
      }

      let user;
      try {
        user = await verifyToken(`Bearer ${token}`);
      } catch {
        return Response.json({ message: 'Invalid or expired token' }, { status: 401 });
      }

      // Verificar que el proyecto pertenece al usuario
      try {
        assertProjectOwner(user, projectId);
      } catch (err: any) {
        return Response.json({ message: err.message }, { status: err.status ?? 403 });
      }

      const data: TerminalSession = {
        projectId,
        userId: user.sub,
        sandboxWs: null,
        pendingMessages: [],
      };

      // Upgrade a WebSocket
      const upgraded = server.upgrade(req, { data });
      if (upgraded) return;
      return new Response('WebSocket upgrade required', { status: 426 });
    }

    // ── HTTP Routes ──────────────────────────────────────────────
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    if (!checkRateLimit(ip)) {
      return Response.json({ message: 'Too many requests' }, { status: 429, headers: { ...cors, 'Retry-After': '60' } });
    }

    try {
      if (url.pathname === '/health' && method === 'GET') {
        return Response.json({ status: 'ok', timestamp: new Date().toISOString() }, { headers: cors });
      }

      const authHeader = req.headers.get('authorization');
      const user = await verifyToken(authHeader);

      if (url.pathname === '/projects') {
        if (method === 'GET') return addCors(await listProjects(user), cors);
        if (method === 'POST') return addCors(await createProject(user, await req.json()), cors);
      }

      const projectMatch = url.pathname.match(/^\/projects\/([^/]+)$/);
      if (projectMatch) {
        if (method === 'DELETE') return addCors(await deleteProject(user, projectMatch[1]), cors);
        if (method === 'PATCH') return addCors(await updateProject(user, projectMatch[1], await req.json()), cors);
      }


      if (url.pathname === '/agent/run' && method === 'POST') {
        return addCors(await runAgent(user, await req.json()), cors);
      }

      return Response.json({ message: 'Not found' }, { status: 404, headers: cors });

    } catch (err) {
      const error = err as Error & { status?: number };
      const status = error.status ?? 401;
      console.error(`[API Error] ${method} ${url.pathname}: ${error.message}`);
      return Response.json(
        { message: error.message || 'Unauthorized' },
        { status: status >= 400 ? status : 401, headers: cors }
      );
    }
  },

  // ── WebSocket handlers ────────────────────────────────────────
  websocket: {
    open(ws) {
      const { projectId } = ws.data;
      const sandboxWsUrl = `${SANDBOX_WS_URL}/terminal?projectId=${projectId}`;
      console.log(`[ws-proxy] Connecting to sandbox: ${sandboxWsUrl}`);

      const sandbox = new WebSocket(sandboxWsUrl);

      sandbox.onopen = () => {
        ws.data.sandboxWs = sandbox;
        console.log(`[ws-proxy] Sandbox connected for project ${projectId}`);
        // Enviar mensajes pendientes (llegaron antes de que sandbox abriera)
        for (const msg of ws.data.pendingMessages) {
          sandbox.send(msg);
        }
        ws.data.pendingMessages = [];
      };

      sandbox.onmessage = (event) => {
        if (ws.readyState === 1 /* OPEN */) {
          const data = event.data;
          if (typeof data === 'string') {
            ws.sendText(data);
          } else if (data instanceof ArrayBuffer) {
            ws.send(data);
          } else if (data instanceof Blob) {
            data.arrayBuffer().then(buf => ws.send(buf));
          }
        }
      };

      sandbox.onerror = () => {
        ws.sendText('\r\n\x1b[31m[Error: Cannot connect to sandbox]\x1b[0m\r\n');
        ws.close();
      };

      sandbox.onclose = () => {
        if (ws.readyState === 1) ws.close();
      };

      ws.data.sandboxWs = sandbox;
    },

    message(ws, message) {
      const sandbox = ws.data.sandboxWs;
      if (sandbox && sandbox.readyState === WebSocket.OPEN) {
        sandbox.send(message);
      } else {
        // Sandbox aún conectando — encolar
        ws.data.pendingMessages.push(message);
      }
    },

    close(ws) {
      console.log(`[ws-proxy] Client disconnected project=${ws.data.projectId}`);
      ws.data.sandboxWs?.close();
    },

    error(ws, error) {
      console.error(`[ws-proxy] Error: ${error.message}`);
      ws.data.sandboxWs?.close();
    },
  },

  error(err) {
    console.error('[Server Error]', err);
    return Response.json({ message: 'Internal server error' }, { status: 500 });
  },
});

console.log(`🚀 API server running on http://0.0.0.0:${PORT}`);
console.log(`🖥️  Terminal WS proxy: ws://0.0.0.0:${PORT}/terminal`);
console.log(`🔒 JWT verification via JWKS: ${process.env.SUPABASE_JWKS_URL}`);
