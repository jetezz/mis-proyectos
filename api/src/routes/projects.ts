import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { guardPath, validateRepoUrl } from '../lib/validator';
import type { AuthPayload } from '../auth';

// Persistencia en archivo (.projects.db)
const DB_PATH = path.join(__dirname, '.projects.db');
let projectStore = new Map<string, {
  id: string;
  userId: string;
  repoUrl: string;
  name: string;
  createdAt: string;
}>();

function loadDb() {
  if (fs.existsSync(DB_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
      projectStore = new Map(Object.entries(data));
    } catch (e) {
      console.error('Failed to load DB', e);
    }
  }
}

function saveDb() {
  try {
    const data = Object.fromEntries(projectStore.entries());
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Failed to save DB', e);
  }
}

loadDb();

export async function listProjects(user: AuthPayload): Promise<Response> {
  // Sync con el sandbox para adoptar proyectos en disco que no estén en la base de datos (por reinicios)

  try {
    const sandboxUrl = process.env.SANDBOX_URL || 'http://sandbox:4000';
    const res = await fetch(`${sandboxUrl}/list`);
    if (res.ok) {
      const data = await res.json() as { projects: { projectId: string; repoUrl: string }[] };
      let changed = false;
      for (const { projectId, repoUrl } of data.projects) {
        if (!projectStore.has(projectId)) {
          // Adoptar proyecto huérfano con este usuario
          const name = repoUrl ? repoUrl.split('/').at(-1)?.replace('.git', '') : projectId;
          projectStore.set(projectId, {
            id: projectId,
            userId: user.sub,
            repoUrl: repoUrl || `https://github.com/unknown/${projectId}`,
            name: name || projectId,
            createdAt: new Date().toISOString(),
          });
          changed = true;
        }
      }
      if (changed) saveDb();
    }
  } catch (e) {
    console.error('Failed to sync with sandbox', e);
  }

  const projects = Array.from(projectStore.values())
    .filter(p => p.userId === user.sub)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return Response.json(projects);
}

/**
 * POST /projects
 * Clona un repositorio en el sandbox.
 *
 * Body: { repoUrl: string }
 */
export async function createProject(user: AuthPayload, body: unknown): Promise<Response> {
  const { repoUrl } = body as { repoUrl?: string };

  // 1. Validar URL (solo HTTPS GitHub/GitLab)
  const safeUrl = validateRepoUrl(repoUrl ?? '');

  // 2. Generar ID único
  const projectId = randomUUID();

  // 3. Verificar path guard
  guardPath(projectId);

  // 4. Enviar git clone al sandbox
  const sandboxUrl = process.env.SANDBOX_URL || 'http://sandbox:4000';

  const sandboxRes = await fetch(`${sandboxUrl}/clone`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, repoUrl: safeUrl }),
  });

  if (!sandboxRes.ok) {
    const err = await sandboxRes.json().catch(() => ({ message: 'Sandbox error' }));
    return Response.json({ message: err.message }, { status: 502 });
  }

  // 5. Extraer nombre del repo de la URL
  const repoName = safeUrl.split('/').at(-1)?.replace('.git', '') ?? projectId;

  // 6. Guardar en store
  const project = {
    id: projectId,
    userId: user.sub,
    repoUrl: safeUrl,
    name: repoName,
    createdAt: new Date().toISOString(),
  };

  projectStore.set(projectId, project);
  saveDb();

  return Response.json(project, { status: 201 });
}

/**
 * DELETE /projects/:id
 * Elimina un proyecto (solo si pertenece al usuario).
 */
export async function deleteProject(user: AuthPayload, projectId: string): Promise<Response> {
  const project = projectStore.get(projectId);

  if (!project) {
    return Response.json({ message: 'Project not found' }, { status: 404 });
  }

  if (project.userId !== user.sub) {
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }

  // Eliminar en sandbox
  const sandboxUrl = process.env.SANDBOX_URL || 'http://sandbox:4000';

  await fetch(`${sandboxUrl}/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  }).catch(() => {/* best effort */ });

  projectStore.delete(projectId);
  saveDb();

  return new Response(null, { status: 204 });
}

/**
 * PATCH /projects/:id
 * Actualiza el nombre de un proyecto.
 */
export async function updateProject(user: AuthPayload, projectId: string, body: unknown): Promise<Response> {
  const { name } = body as { name?: string };

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return Response.json({ message: 'Name is required' }, { status: 400 });
  }

  const project = projectStore.get(projectId);

  if (!project) {
    return Response.json({ message: 'Project not found' }, { status: 404 });
  }

  if (project.userId !== user.sub) {
    return Response.json({ message: 'Forbidden' }, { status: 403 });
  }

  project.name = name.trim();
  saveDb();

  return Response.json(project);
}

/**
 * Verifica que un projectId pertenece al usuario.

 * Usada por la ruta del agente.
 */
export function assertProjectOwner(user: AuthPayload, projectId: string): void {
  const project = projectStore.get(projectId);

  if (!project) {
    throw Object.assign(new Error('Project not found'), { status: 404 });
  }

  if (project.userId !== user.sub) {
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  }
}
