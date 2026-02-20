# 🤖 AGENTS.md — Guía para Agentes IA

> Este archivo contiene la información crítica que cualquier agente IA debe conocer para trabajar en este proyecto de forma segura y consistente.

---

## 📋 Índice

1. [Visión General del Proyecto](#1-visión-general-del-proyecto)
2. [Arquitectura y Componentes](#2-arquitectura-y-componentes)
3. [Stack Tecnológico](#3-stack-tecnológico)
4. [Reglas de Seguridad Inquebrantables](#4-reglas-de-seguridad-inquebrantables)
5. [Patrones de Código](#5-patrones-de-código)
6. [Estructura de Archivos](#6-estructura-de-archivos)
7. [Flujo de Autenticación](#7-flujo-de-autenticación)
8. [Terminal WebSocket — Flujo Completo](#8-terminal-websocket--flujo-completo)
9. [Sidebar: Skills, Agents, Commands](#9-sidebar-skills-agents-commands)
10. [Convenciones de Desarrollo](#10-convenciones-de-desarrollo)
11. [Errores Comunes a Evitar](#11-errores-comunes-a-evitar)
12. [Testing y Verificación](#12-testing-y-verificación)

---

## 1. Visión General del Proyecto

**OpenCode Agent** es una plataforma web que permite a usuarios gestionar proyectos de código a través de un terminal web interactivo. Cada proyecto se clona en un sandbox Docker aislado, y el usuario interactúa con su terminal desde el navegador mediante WebSocket + PTY.

### Conceptos Clave

| Concepto | Descripción |
|----------|-------------|
| **Proyecto** | Repositorio Git clonado en `/workspace/projects/<uuid>` |
| **Sandbox** | Contenedor Docker aislado que ejecuta los procesos (PTY, git, OpenCode) |
| **Terminal** | Sesión PTY real (bash/sh) conectada vía WebSocket al navegador |
| **Skill** | Archivo de instrucciones/contexto que el usuario crea para un proyecto |
| **Agent** | Configuración de un agente IA (prompt, modelo) para un proyecto |
| **Command** | Comando shell reutilizable que se ejecuta con un click en el terminal |
| **Ownership** | Cada recurso pertenece a un `userId` (claim `sub` del JWT de Supabase) |

---

## 2. Arquitectura y Componentes

```
┌─────────────────────────────────────────────────────────────┐
│                    INTERNET (Puerto 80)                      │
│                         │                                    │
│                ┌────────▼────────┐                           │
│                │   FRONTEND      │  Astro SSR (Node)         │
│                │   /login        │  Único punto expuesto     │
│                │   /dashboard    │  Middleware auth global    │
│                │   /project/[id] │  Verificación ownership   │
│                └────────┬────────┘                           │
│                         │ JWT Authorization header           │
│                ┌────────▼────────┐                           │
│                │   API (Bun)     │  Red interna Docker       │
│                │   HTTP: :3000   │  JWKS JWT verification    │
│                │   WS:  :3000    │  WS proxy autenticado     │
│                └────────┬────────┘                           │
│                         │ WS proxy sin auth (red interna)    │
│                ┌────────▼────────┐                           │
│                │   SANDBOX       │  Contenedor aislado       │
│                │   HTTP: :4000   │  cap_drop: ALL            │
│                │   WS:  :4000    │  no-new-privileges        │
│                │   PTY (node-pty)│  user: sandboxuser         │
│                └────────┬────────┘                           │
│                         │                                    │
│              /workspace/projects/ (volumen montado)          │
│                                                              │
│   ┌─ /workspace/projects/<projectId>/  ────────────────┐    │
│   │  📁 (source code del repo clonado)                  │    │
│   │  📁 .home/            ← HOME aislado por proyecto   │    │
│   │     ├── .bashrc       ← Config shell del proyecto   │    │
│   │     ├── .opencode/    ← CLI solo para ESTE proyecto │    │
│   │     ├── .config/      ← MCP configs por proyecto    │    │
│   │     └── .local/       ← Tools locales del proyecto  │    │
│   └────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Flujo de datos de la terminal

```
Browser → WS → Frontend (proxy pass) → WS → API (JWT verify + ownership) → WS → Sandbox (PTY)
```

---

## 3. Stack Tecnológico

| Componente | Tecnología | Notas |
|------------|-----------|-------|
| Frontend | **Astro 5.x** + Node SSR Adapter | SSR obligatorio (no static) |
| UI Terminal | **xterm.js 5.x** + FitAddon + WebLinksAddon | Renderizado en cliente |
| Backend/API | **Bun 1.x** HTTP Server | Sin Express/Hono — server nativo Bun |
| Auth | **Supabase Auth** | JWT verificado con JWKS (librería `jose`) |
| DB Metadata | **Supabase PostgreSQL** | Para skills, agents, commands (con RLS) |
| Sandbox | **Docker Alpine** + node-pty + ws | Contenedor aislado |
| Orquestación | **Docker Compose v2** | 3 servicios: frontend, api, sandbox |

### Dependencias Críticas

```
Frontend:
  @supabase/supabase-js    → Cliente auth
  @xterm/xterm             → Terminal web
  @xterm/addon-fit         → Auto-resize terminal
  @xterm/addon-web-links   → URLs clickeables en terminal

API (Bun):
  jose                     → Verificación JWT con JWKS
  (built-in Bun.serve)     → HTTP + WebSocket server

Sandbox:
  node-pty                 → PTY real (pseudo-terminal)
  ws                       → WebSocket server
```

---

## 4. Reglas de Seguridad Inquebrantables

> ⚠️ **CRÍTICO:** Estas reglas NUNCA deben violarse. Cualquier cambio que las rompa debe ser rechazado.

### 4.1 Ejecución de Comandos

```
✅ CORRECTO:
spawn('git', ['clone', '--depth=1', repoUrl, projectPath], { shell: false })

❌ INCORRECTO (NUNCA HACER):
exec(`git clone ${repoUrl} ${projectPath}`)
spawn(`git clone ${repoUrl}`, { shell: true })
```

- **Siempre** usar `spawn()` con array de argumentos
- **Nunca** usar `exec()`, `execSync()`, ni `shell: true`
- **Nunca** interpolar variables de usuario en strings de comandos

### 4.2 Path Traversal

```typescript
// SIEMPRE validar paths antes de usarlos
function guardPath(projectId: string): string {
  // 1. Validar formato (solo alfanumérico, guiones, guiones bajos)
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(projectId)) {
    throw new Error('Invalid projectId format');
  }
  // 2. Resolver path absoluto
  const fullPath = path.resolve(WORKSPACE_BASE, projectId);
  // 3. Verificar que está dentro del workspace
  if (!fullPath.startsWith(WORKSPACE_BASE + path.sep)) {
    throw new Error('Path traversal attempt');
  }
  return fullPath;
}
```

### 4.3 Autenticación JWT

```typescript
// API: Verificar SIEMPRE con JWKS, NUNCA confiar en el payload sin verificar
import { createRemoteJWKSet, jwtVerify } from 'jose';

const JWKS = createRemoteJWKSet(new URL(SUPABASE_JWKS_URL));
const { payload } = await jwtVerify(token, JWKS);
// payload.sub → userId verificado criptográficamente
```

- **Nunca** decodficar el JWT sin verificar la firma
- **Nunca** confiar en `getSession()` para auth server-side — usar `getUser()` que valida contra el servidor
- **Siempre** verificar ownership: `project.userId === user.sub`

### 4.4 WebSocket Security

- El JWT se pasa como `?token=` query parameter (estándar WebSocket — no se pueden enviar headers custom)
- El token se valida **ANTES** del `upgrade` a WebSocket
- Si el token es inválido o el proyecto no pertenece al usuario → respuesta HTTP 401/403, NO se hace upgrade
- Cada conexión WS tiene un timeout (1 hora por defecto)

### 4.5 Docker Security

```yaml
# SIEMPRE en el sandbox:
security_opt:
  - no-new-privileges:true
cap_drop:
  - ALL
# NUNCA exponer puertos del sandbox/API al host en producción
# NUNCA montar volúmenes adicionales fuera de /workspace/projects
```

### 4.6 Supabase RLS (Row Level Security)

```sql
-- SIEMPRE habilitar RLS en tablas con datos de usuario
ALTER TABLE project_skills ENABLE ROW LEVEL SECURITY;

-- SIEMPRE usar auth.uid() para verificar ownership
CREATE POLICY "Users own their data"
  ON project_skills FOR ALL
  USING (auth.uid() = user_id);
```

### 4.7 Aislamiento HOME por Proyecto (Per-Project Isolation)

> ⚠️ **CRÍTICO:** Cada proyecto DEBE tener su propio directorio HOME aislado. Esto previene que herramientas instaladas en un proyecto aparezcan en otro.

**Problema resuelto:** Un mismo sandbox contenedor sirve a múltiples proyectos. Sin aislamiento, `curl install opencode` en Proyecto A haría que OpenCode apareciera en Proyecto B. Configuraciones de MCP (Supabase prod vs dev, APIs distintas) se mezclarían.

**Solución implementada:**

```javascript
// Cada proyecto tiene su HOME en: /workspace/projects/<projectId>/.home/
function getProjectHome(projectId) {
  const projectPath = guardPath(projectId);
  return path.join(projectPath, '.home');
}

// El PTY usa este HOME aislado
pty.spawn(shell, ['--rcfile', projectHome + '/.bashrc'], {
  env: {
    HOME: projectHome,         // ← HOME aislado
    PATH: `${projectHome}/.opencode/bin:...`,  // ← PATH aislado
  }
});
```

**Resultado:**

| Proyecto | HOME | OpenCode Path | MCP Config |
|----------|------|---------------|------------|
| Proyecto A (prod) | `.../A/.home` | `.../A/.home/.opencode/` | `.../A/.home/.config/` |
| Proyecto B (dev) | `.../B/.home` | `.../B/.home/.opencode/` | `.../B/.home/.config/` |

**Caso de uso principal:** El usuario puede tener un proyecto apuntando a Supabase prod y otro a Supabase dev, cada uno con sus propias configuraciones de MCP server, sin interferencia.

**Reglas:**
- **NUNCA** usar `/home/sandboxuser` como HOME para terminales de proyecto
- **SIEMPRE** usar `getProjectHome(projectId)` para obtener el HOME aislado
- **SIEMPRE** pasar el HOME aislado al PTY spawn via `getProjectEnv()`
- La carpeta `.home` se crea automáticamente con un `.bashrc` per-project

## 5. Patrones de Código

### 5.1 Frontend — Astro SSR Pages

```astro
---
// SIEMPRE: Auth guard en el frontmatter
import { createSupabaseServerClient } from '../lib/supabase-server';

const supabase = createSupabaseServerClient(Astro.request.headers, Astro.cookies);
const { data: { user }, error } = await supabase.auth.getUser();
if (!user || error) return Astro.redirect('/login');

// Para páginas de proyecto: verificar ownership
const projectId = Astro.params.id;
// ... verificar que el proyecto pertenece al user
---
```

### 5.2 Frontend — Middleware Astro

```typescript
// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const publicPaths = ['/', '/login'];
  if (publicPaths.includes(context.url.pathname)) return next();
  if (context.url.pathname.startsWith('/_')) return next(); // Astro internals

  // Verificar sesión
  const supabase = createSupabaseServerClient(context.request.headers, context.cookies);
  const { data: { user } } = await supabase.auth.getUser();
  
  if (!user) return context.redirect('/login');
  
  context.locals.user = user;
  return next();
});
```

### 5.3 API — Route Handler Pattern

```typescript
// Patrón para TODAS las rutas del API
export async function handler(user: AuthPayload, body: unknown): Promise<Response> {
  // 1. Validar input
  // 2. Verificar ownership del recurso
  // 3. Ejecutar lógica
  // 4. Retornar Response
}
```

### 5.4 WebSocket — JSON Messages

```typescript
// Browser → Server (entrada)
{ type: 'input', data: 'ls -la\r' }
{ type: 'resize', cols: 120, rows: 30 }

// Server → Browser (salida)
// Strings planos con códigos ANSI (no JSON)
```

### 5.5 CSS — Design Tokens

```css
/* El proyecto usa variables CSS globales definidas en Layout.astro */
:root {
  --bg: #0a0a0f;
  --bg-card: #12121a;
  --bg-card-hover: #1a1a2e;
  --border: rgba(255,255,255,0.08);
  --text-primary: #f0f0ff;
  --text-secondary: #8888aa;
  --text-muted: #555566;
  --accent: #5b5bf6;
  --danger: #ef4444;
  --success: #22c55e;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --radius-sm: 6px;
  --radius-lg: 12px;
}
```

---

## 6. Estructura de Archivos

### Frontend (`frontend/src/`)

| Archivo | Propósito |
|---------|-----------|
| `middleware.ts` | Auth guard global para todas las rutas protegidas |
| `pages/index.astro` | Redirect a `/login` o `/dashboard` |
| `pages/login.astro` | Login con Supabase Auth UI |
| `pages/dashboard.astro` | Grid de proyectos, modal "Añadir Proyecto" |
| `pages/project/[id].astro` | **Página dedicada del proyecto** con terminal + sidebar |
| `lib/supabase.ts` | Cliente Supabase (browser) |
| `lib/supabase-server.ts` | Cliente Supabase (SSR) |
| `lib/api.ts` | Funciones helper para llamadas a la API con JWT |
| `layouts/Layout.astro` | Layout base con design tokens CSS |

### API (`api/src/`)

| Archivo | Propósito |
|---------|-----------|
| `index.ts` | Servidor principal: HTTP routes + WebSocket proxy |
| `auth.ts` | Verificación JWT con JWKS (librería `jose`) |
| `routes/projects.ts` | CRUD de proyectos + `assertProjectOwner()` |
| `routes/agent.ts` | Ejecución de OpenCode (SSE streaming) |
| `routes/skills.ts` | CRUD de skills por proyecto |
| `routes/agents.ts` | CRUD de agents por proyecto |
| `routes/commands.ts` | CRUD de comandos por proyecto |
| `lib/validator.ts` | `guardPath()` + `validateRepoUrl()` |

### Sandbox (`sandbox/`)

| Archivo | Propósito |
|---------|-----------|
| `Dockerfile` | Alpine + node-pty + ws, usuario no-root |
| `agent.js` | HTTP server + WebSocket PTY server |

---

## 7. Flujo de Autenticación

### Login → Dashboard

```
1. Usuario visita /login
2. Supabase Auth UI (email/password)
3. Supabase devuelve JWT + refresh token (almacenados en cookies httpOnly)
4. Redirect a /dashboard
5. Middleware verifica sesión con getUser() (server-side)
6. Dashboard carga: SSR renderiza la página con el usuario verificado
```

### Dashboard → Proyecto

```
1. Usuario clickea "Abrir Terminal" en un proyecto
2. Navegación a /project/:projectId
3. Middleware verifica sesión (getUser)
4. Página SSR verifica ownership del proyecto (API call)
5. Si OK → renderiza terminal + sidebar
6. Si NO → redirect a /dashboard
```

### Terminal WebSocket

```
1. Página /project/[id] se carga (SSR verified)
2. Client-side JS obtiene access token: supabase.auth.getSession()
3. Abre WebSocket: ws://api:3000/terminal?projectId=X&token=JWT
4. API verifyToken(JWT) → si inválido, HTTP 401 (NO upgrade)
5. API assertProjectOwner(user, projectId) → si no owner, HTTP 403
6. Upgrade a WebSocket exitoso
7. API abre WS a sandbox: ws://sandbox:4000/terminal?projectId=X
8. Proxy bidireccional: Browser ↔ API ↔ Sandbox PTY
```

---

## 8. Terminal WebSocket — Flujo Completo

### Cadena de conexiones

```
Browser (xterm.js)
    ↕ WebSocket (autenticado con JWT)
API (Bun.serve WebSocket proxy)
    ↕ WebSocket (red interna, sin auth)
Sandbox (node-pty spawn bash)
```

### Mensajes

| Dirección | Formato | Ejemplo |
|-----------|---------|---------|
| Browser → API → Sandbox | JSON | `{"type":"input","data":"ls\r"}` |
| Browser → API → Sandbox | JSON | `{"type":"resize","cols":120,"rows":30}` |
| Sandbox → API → Browser | String (ANSI) | `\x1b[32mhello\x1b[0m` |

### Configuración xterm.js recomendada

```typescript
new Terminal({
  theme: { background: '#0a0a0f', foreground: '#e0e0ff', cursor: '#5b5bf6' },
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: 14,
  lineHeight: 1.4,
  cursorBlink: true,
  cursorStyle: 'block',
  scrollback: 5000,
  allowProposedApi: true,
});
```

### Addons recomendados

- `@xterm/addon-fit` — Auto-resize al contenedor
- `@xterm/addon-web-links` — URLs clickeables
- `@xterm/addon-search` — Buscar texto (Ctrl+F)

---

## 9. Dashboard: Skills, Agents, Commands

### Layout de la Página de Proyecto

La página `/project/[id]` usa un **layout vertical** donde:
- **Área principal** (arriba, ~70% del viewport): Dashboard con tabs para Comandos, Skills, Agents
- **Terminal** (abajo, ~30% del viewport): Panel colapsable con xterm.js

Los comandos son la funcionalidad principal (accesos rápidos ejecutables).
La terminal es una herramienta secundaria que se expande/colapsa.

### Scope: Global vs Per-Project

**Skills** y **Agents** tienen dos scopes:
- **📁 Proyecto**: Solo visibles en el proyecto actual (`oc-skills-{projectId}`)
- **🌐 Global**: Visibles en TODOS los proyectos del usuario (`oc-skills-global`)

El scope se selecciona al crear/editar mediante radio buttons. Un toggle en la toolbar cambia la vista entre project y global.

**Commands** son siempre per-project (no tienen scope global).

### Estructura de datos

```typescript
interface SkillItem {
  id: string;
  name: string;
  content: string;
  description?: string;
  scope: 'project' | 'global';  // ← NUEVO: alcance del skill
}

interface AgentItem {
  id: string;
  name: string;
  systemPrompt: string;
  description?: string;
  model: string;
  scope: 'project' | 'global';  // ← NUEVO: alcance del agent
}

interface CommandItem {
  id: string;
  name: string;
  command: string;
  description?: string;
  icon: string;
}
```

### Storage Keys

| Key | Scope | Descripción |
|-----|-------|-------------|
| `oc-commands-{projectId}` | Proyecto | Comandos del proyecto |
| `oc-skills-{projectId}` | Proyecto | Skills del proyecto |
| `oc-skills-global` | Global | Skills compartidos |
| `oc-agents-{projectId}` | Proyecto | Agents del proyecto |
| `oc-agents-global` | Global | Agents compartidos |

### Almacenamiento

- **Actual:** `localStorage` con keys separadas por scope
- **Futuro (Recomendado):** Tablas Supabase con RLS y columna `scope`

---

## 10. Convenciones de Desarrollo

### Naming

| Tipo | Convención | Ejemplo |
|------|-----------|---------|
| Archivos Astro | kebab-case | `project-terminal.astro` |
| Archivos TS/TSX | PascalCase para componentes | `SkillsPanel.tsx` |
| Funciones | camelCase | `getAccessToken()` |
| Variables CSS | kebab-case con `--` | `--bg-card-hover` |
| Rutas API | kebab-case | `/projects/:id/skills` |
| IDs HTML | kebab-case | `terminal-container` |

### Imports

```typescript
// 1. Node/Bun built-ins
import path from 'node:path';

// 2. Dependencias externas
import { jwtVerify } from 'jose';

// 3. Módulos locales
import { verifyToken } from './auth';
```

### Error Handling

```typescript
// API: Siempre devolver Response con status code apropiado
try {
  const result = await operation();
  return Response.json(result);
} catch (err) {
  const error = err as Error & { status?: number };
  return Response.json(
    { message: error.message },
    { status: error.status ?? 500 }
  );
}
```

### CSS

- **No usar** frameworks CSS (ni Tailwind ni Bootstrap) — Vanilla CSS con custom properties
- **Siempre** usar las variables CSS definidas en `Layout.astro`
- **Dark mode** por defecto (el fondo es `#0a0a0f`)
- **Diseño responsivo**: mobile-first, breakpoints con `@media`

---

## 11. Errores Comunes a Evitar

### ❌ No hacer NUNCA

1. **No confiar en `getSession()`** para auth server-side → usar `getUser()` que valida contra Supabase
2. **No usar `shell: true`** en spawn — siempre array de argumentos
3. **No interpolar** variables de usuario en strings de shell
4. **No exponer** puertos de API/sandbox al host en producción
5. **No almacenar** tokens en localStorage — usar cookies httpOnly
6. **No renderizar** HTML de usuario sin sanitizar (XSS)
7. **No olvidar** RLS en tablas de Supabase
8. **No montar** volúmenes adicionales en el sandbox
9. **No usar** `innerHTML` con datos del usuario — usar `textContent`
10. **No omitir** la verificación de ownership en cada operación

### ⚠️ Gotchas conocidos

1. **WebSocket en Astro**: Astro SSR no maneja WebSocket nativamente. El WebSocket va directamente al API (`:3000/terminal`), no a través de Astro
2. **Cookies Supabase**: En SSR, las cookies deben parsearse del header `Cookie` manualmente. Usar `createSupabaseServerClient()` que hace esto
3. **node-pty en Alpine**: Requiere `python3`, `make`, `g++` en build time — ver `sandbox/Dockerfile`
4. **Bun WebSocket**: Bun usa una API de WebSocket diferente a Node.js. `ws.send()` vs `ws.sendText()` — revisar la API de `Bun.serve()`
5. **xterm.js resize**: Siempre llamar `fitAddon.fit()` DESPUÉS de que el contenedor tenga dimensiones en el DOM (usar `setTimeout` o `ResizeObserver`)

---

## 12. Testing y Verificación

### Verificaciones de seguridad obligatorias

Antes de cada deploy o PR, verificar:

```bash
# 1. Solo puerto 80 expuesto en producción
docker compose config | grep -A2 "ports:"

# 2. Sandbox sin capabilities
docker inspect <sandbox-container> | grep -A5 "CapDrop"

# 3. Sandbox usuario no-root
docker exec <sandbox-container> whoami  # debe ser "sandboxuser"

# 4. API no accesible desde el host
curl http://localhost:3000/health  # debe FALLAR en producción

# 5. CORS configurado correctamente
curl -H "Origin: https://evil.com" http://localhost:3000/health
# Debe rechazar el origen
```

### Herramientas de testing recomendadas

| Herramienta | Propósito |
|------------|-----------|
| Playwright | E2E tests (login → dashboard → terminal) |
| curl/httpie | Testing manual de API |
| wscat | Testing manual de WebSocket |
| Docker inspect | Verificar security config del sandbox |

---

> **Nota final:** Este documento debe mantenerse actualizado con cada cambio significativo en la arquitectura, seguridad o patrones del proyecto. Los agentes IA deben leer este archivo ANTES de hacer cualquier modificación al código.
