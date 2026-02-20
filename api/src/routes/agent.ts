import { guardPath, validatePrompt } from '../lib/validator';
import { assertProjectOwner } from './projects';
import type { AuthPayload } from '../auth';

const SANDBOX_URL = process.env.SANDBOX_URL || 'http://sandbox:4000';
const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

/**
 * POST /agent/run
 * Ejecuta OpenCode en el sandbox para un proyecto específico.
 * Devuelve un stream SSE con la salida del agente.
 *
 * Body: { projectId: string, prompt: string }
 */
export async function runAgent(user: AuthPayload, body: unknown): Promise<Response> {
  const { projectId, prompt } = body as { projectId?: string; prompt?: string };

  if (!projectId) {
    return Response.json({ message: 'projectId is required' }, { status: 400 });
  }

  // 1. Verificar ownership
  assertProjectOwner(user, projectId);

  // 2. Path guard (¡siempre antes de enviar al sandbox!)
  const safePath = guardPath(projectId);

  // 3. Validar prompt
  const safePrompt = validatePrompt(prompt ?? '');

  // 4. Llamar al sandbox con timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  let sandboxRes: Response;

  try {
    sandboxRes = await fetch(`${SANDBOX_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        projectPath: safePath,
        prompt: safePrompt,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if ((err as Error).name === 'AbortError') {
      return Response.json({ message: 'Agent execution timed out' }, { status: 504 });
    }
    return Response.json({ message: 'Sandbox unreachable' }, { status: 502 });
  }

  clearTimeout(timeoutId);

  if (!sandboxRes.ok || !sandboxRes.body) {
    const err = await sandboxRes.json().catch(() => ({ message: 'Sandbox error' }));
    return Response.json({ message: err.message }, { status: 502 });
  }

  // 5. Proxy del stream SSE del sandbox al cliente
  return new Response(sandboxRes.body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
