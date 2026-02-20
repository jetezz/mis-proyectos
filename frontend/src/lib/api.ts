import { getAccessToken } from './supabase';

const API_BASE = '/api';

/**
 * Wrapper fetch que inyecta automáticamente el JWT de Supabase
 * en el header Authorization de cada petición al backend.
 */
async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();

  if (!token) {
    throw new Error('No authenticated session');
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    ...options.headers,
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Unknown error' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response;
}

// ─── Projects API ───────────────────────────────────────────────

export interface Project {
  id: string;
  repoUrl: string;
  name: string;
  createdAt: string;
}

export async function getProjects(): Promise<Project[]> {
  const res = await apiFetch('/projects');
  return res.json();
}

export async function addProject(repoUrl: string): Promise<Project> {
  const res = await apiFetch('/projects', {
    method: 'POST',
    body: JSON.stringify({ repoUrl }),
  });
  return res.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch(`/projects/${projectId}`, { method: 'DELETE' });
}

export async function updateProject(projectId: string, name: string): Promise<Project> {
  const res = await apiFetch(`/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return res.json();
}


// ─── Agent API ────────────────────────────────────────────────────

export interface AgentRunOptions {
  projectId: string;
  prompt: string;
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

/**
 * Lanza OpenCode en el sandbox y recibe la salida via Server-Sent Events.
 */
export async function runAgent({ projectId, prompt, onChunk, onDone, onError }: AgentRunOptions) {
  const token = await getAccessToken();

  if (!token) {
    onError(new Error('No authenticated session'));
    return;
  }

  const res = await fetch(`${API_BASE}/agent/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ projectId, prompt }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: `HTTP ${res.status}` }));
    onError(new Error(err.message));
    return;
  }

  // Leer stream SSE
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();

  if (!reader) {
    onError(new Error('No response body'));
    return;
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      onDone();
      break;
    }
    const text = decoder.decode(value, { stream: true });
    // Parse SSE lines
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          onDone();
          return;
        }
        onChunk(data);
      }
    }
  }
}
