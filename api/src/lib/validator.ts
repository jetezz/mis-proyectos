import path from 'node:path';

const WORKSPACE_BASE = '/workspace/projects';

/**
 * Protección contra Path Traversal.
 *
 * Verifica que la ruta resuelta esté estrictamente dentro de WORKSPACE_BASE.
 * Cualquier intento de "../../../etc/passwd" será bloqueado aquí.
 *
 * @throws Error si la ruta no está dentro del workspace permitido
 */
export function guardPath(projectId: string): string {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId');
  }

  // Solo permitir UUID v4 o slugs alfanuméricos seguros
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(projectId)) {
    throw new Error('Invalid projectId format — only alphanumeric, hyphens and underscores allowed');
  }

  const fullPath = path.resolve(WORKSPACE_BASE, projectId);

  if (!fullPath.startsWith(WORKSPACE_BASE + path.sep) && fullPath !== WORKSPACE_BASE) {
    throw new Error(`Path traversal attempt detected: ${fullPath}`);
  }

  return fullPath;
}

/**
 * Valida que una URL de repositorio sea segura.
 * Solo acepta HTTPS de GitHub o GitLab.
 */
export function validateRepoUrl(url: string): string {
  if (!url || typeof url !== 'string') {
    throw new Error('repoUrl is required');
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS URLs are allowed');
  }

  const allowedHosts = ['github.com', 'gitlab.com', 'bitbucket.org'];
  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error(`Only repositories from ${allowedHosts.join(', ')} are allowed`);
  }

  // Sin credenciales embebidas en la URL
  if (parsed.username || parsed.password) {
    throw new Error('Credentials in URL are not allowed');
  }

  return url;
}

/**
 * Valida el prompt enviado a OpenCode.
 * Previene prompts vacíos o excesivamente largos.
 */
export function validatePrompt(prompt: string): string {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('prompt is required');
  }

  const trimmed = prompt.trim();

  if (trimmed.length === 0) {
    throw new Error('prompt cannot be empty');
  }

  if (trimmed.length > 4000) {
    throw new Error('prompt exceeds maximum length of 4000 characters');
  }

  return trimmed;
}
