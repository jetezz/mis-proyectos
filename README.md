# 🛡️ OpenCode Agent — Agente Local Controlado Vía Web

Un agente local seguro que permite gestionar proyectos de código con **aislamiento real**, validación criptográfica JWT y superficie de ataque mínima.

---

## 📋 Tabla de Contenidos

1. [Arquitectura](#arquitectura)
2. [Stack Tecnológico](#stack-tecnológico)
3. [Estructura del Proyecto](#estructura-del-proyecto)
4. [Requisitos Previos](#requisitos-previos)
5. [Configuración de Supabase](#configuración-de-supabase)
6. [Variables de Entorno](#variables-de-entorno)
7. [Instalación y Desarrollo](#instalación-y-desarrollo)
8. [Producción con Docker](#producción-con-docker)
9. [Flujos de Uso](#flujos-de-uso)
10. [Seguridad](#seguridad)
11. [API Reference](#api-reference)
12. [Desarrollo — Mejoras Planificadas](#desarrollo--mejoras-planificadas)
13. [Roadmap](#roadmap)

---

## Arquitectura

```
                Internet
                   │
                   ▼
            ┌──────────────┐
            │   Astro FE   │  ← ÚNICO punto expuesto (puerto 80)
            │  (Node SSR)  │
            └──────────────┘
                   │  JWT en header Authorization
                   ▼
            ┌──────────────┐
            │  API (Bun)   │  ← Red interna Docker únicamente
            │ JWT Verify   │
            └──────────────┘
                   │  Bun.spawn (args array, sin shell)
                   ▼
            ┌──────────────┐
            │   Sandbox    │  ← Contenedor aislado
            │  (OpenCode)  │    cap_drop: ALL
            └──────────────┘    no-new-privileges
                   │
                   ▼
        /workspace/projects ← Único volumen montado
```

**Principios de seguridad:**
- Solo el frontend está expuesto a Internet
- API y Sandbox solo accesibles en red interna Docker
- JWT verificado criptográficamente con clave pública JWKS de Supabase
- Sandbox con usuario no-root y sin capabilities Linux
- `spawn()` con array de argumentos (nunca string shell)
- Path traversal protection en cada operación
- **HOME aislado por proyecto** — cada proyecto tiene su propio `$HOME` dentro de `.home/`, impidiendo que herramientas instaladas en un proyecto contaminen a otro

---

## Stack Tecnológico

| Componente | Tecnología | Versión |
|------------|-----------|---------|
| Frontend   | Astro + Node SSR Adapter | 5.x |
| Backend    | Bun HTTP Server | 1.x |
| Auth       | Supabase Auth + JWT (JWKS) | -- |
| Sandbox    | Docker Alpine + OpenCode | -- |
| Orquestación | Docker Compose | v2 |
| Terminal   | xterm.js + @xterm/addon-fit + @xterm/addon-web-links | 5.x |

---

## Estructura del Proyecto

```
opencode-agent/
│
├── README.md                    ← Este archivo
├── AGENTS.md                    ← Guía para agentes IA: puntos clave del proyecto
├── .env                         ← Variables de entorno (NO commitear)
├── .env.example                 ← Plantilla de variables
├── docker-compose.yml           ← Producción (seguro)
├── docker-compose.dev.yml       ← Desarrollo local
│
├── frontend/                    ← Astro SSR
│   ├── Dockerfile
│   ├── package.json
│   ├── astro.config.mjs
│   └── src/
│       ├── middleware.ts         ← 🆕 Middleware de autenticación global
│       ├── layouts/
│       │   └── Layout.astro
│       ├── pages/
│       │   ├── index.astro      ← Redirect a /login o /dashboard
│       │   ├── login.astro      ← Login con Supabase Auth UI
│       │   ├── dashboard.astro  ← Panel de proyectos (grid de cards)
│       │   └── project/
│       │       └── [id].astro   ← 🆕 Página dedicada del proyecto con terminal
│       ├── components/
│       │   ├── ProjectList.tsx  ← Lista de proyectos (React/Preact)
│       │   ├── AddProject.tsx   ← Modal añadir proyecto
│       │   ├── ProjectTerminal.tsx ← 🆕 Terminal xterm.js en página completa
│       │   └── Sidebar/
│       │       ├── Sidebar.tsx     ← 🆕 Sidebar lateral colapsable
│       │       ├── SkillsPanel.tsx ← 🆕 CRUD de skills reutilizables
│       │       ├── AgentsPanel.tsx ← 🆕 CRUD de agentes configurables
│       │       └── CommandsPanel.tsx← 🆕 CRUD de comandos rápidos
│       └── lib/
│           ├── supabase.ts      ← Cliente Supabase
│           ├── supabase-server.ts← Cliente SSR Supabase
│           └── api.ts           ← Llamadas al backend con JWT
│
├── api/                         ← Bun HTTP Server
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── index.ts             ← Servidor principal + WS proxy autenticado
│       ├── auth.ts              ← Verificación JWT JWKS
│       ├── routes/
│       │   ├── projects.ts      ← CRUD proyectos
│       │   ├── agent.ts         ← Ejecutar OpenCode
│       │   ├── skills.ts        ← 🆕 CRUD skills por proyecto
│       │   ├── agents.ts        ← 🆕 CRUD agentes por proyecto
│       │   └── commands.ts      ← 🆕 CRUD comandos por proyecto
│       └── lib/
│           ├── sandbox.ts       ← Comunicación con sandbox
│           ├── path-guard.ts    ← Protección path traversal
│           └── validator.ts     ← Validación inputs
│
├── sandbox/                     ← Contenedor aislado
│   ├── Dockerfile
│   └── agent.js                 ← Agente HTTP + WebSocket PTY
│
└── workspace/
    └── projects/                ← Único directorio modificable
```

---

## Requisitos Previos

- **Docker** ≥ 24.x y **Docker Compose** ≥ 2.x
- **Node.js** ≥ 20.x (solo para desarrollo local del frontend)
- **Bun** ≥ 1.x (solo para desarrollo local del API)
- Cuenta en **Supabase** (gratuita)
- **OpenCode** instalado (en el sandbox Dockerfile)

---

## Configuración de Supabase

### 1. Crear proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) → New Project
2. Anotar:
   - `Project URL` → `SUPABASE_URL`
   - `Anon Key` → `SUPABASE_ANON_KEY`
   - `JWT Secret` → Para verificación manual (alternativa a JWKS)

### 2. Obtener JWKS para verificación en backend

La URL JWKS de Supabase es:
```
https://<tu-proyecto>.supabase.co/auth/v1/.well-known/jwks.json
```

El backend usa esta URL para verificar tokens **sin depender del `anon key`**.

### 3. Configurar Auth en Supabase

En Supabase Dashboard → Authentication → Providers:
- Habilitar **Email** (mínimo)
- Configurar `Site URL` apuntando a tu dominio o `http://localhost:80`

### 4. 🆕 Tablas para Skills, Agents y Commands

Crear las siguientes tablas en Supabase para persistir las configuraciones por proyecto:

```sql
-- Skills de un proyecto
CREATE TABLE project_skills (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Agents configurados por proyecto
CREATE TABLE project_agents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  model TEXT DEFAULT 'default',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Comandos rápidos reutilizables
CREATE TABLE project_commands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  description TEXT,
  icon TEXT DEFAULT '⚡',
  keybinding TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 🔒 RLS: Solo el propietario puede acceder a sus recursos
ALTER TABLE project_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can CRUD their own skills"
  ON project_skills FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD their own agents"
  ON project_agents FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users can CRUD their own commands"
  ON project_commands FOR ALL
  USING (auth.uid() = user_id);
```

---

## Variables de Entorno

Copiar `.env.example` a `.env`:

```bash
cp .env.example .env
```

### `.env.example`

```env
# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_JWKS_URL=https://xxxx.supabase.co/auth/v1/.well-known/jwks.json

# API interna (solo usada en docker-compose)
API_URL=http://api:3000

# Entorno
NODE_ENV=production
```

---

## Instalación y Desarrollo

### Modo Desarrollo (sin Docker)

```bash
# 1. Instalar dependencias del frontend
cd frontend && npm install

# 2. Instalar dependencias del API
cd api && bun install

# 3. Levantar en paralelo (dos terminales)
cd frontend && npm run dev     # http://localhost:4321
cd api && bun run dev          # http://localhost:3000
```

### Modo Desarrollo con Docker

```bash
docker compose -f docker-compose.dev.yml up --build
```

Frontend → http://localhost:4321
API → http://localhost:3000 (expuesto solo en dev)

---

## Producción con Docker

```bash
# 1. Configurar variables
cp .env.example .env
# Editar .env con tus valores reales

# 2. Construir y levantar
docker compose up --build -d

# 3. Ver logs
docker compose logs -f

# 4. Parar
docker compose down
```

**Solo el puerto 80 (frontend) está expuesto en producción.**

---

## Flujos de Uso

### Añadir un Proyecto

```
Usuario → /dashboard → "Añadir Proyecto"
        → Introduce URL del repositorio (GitHub/GitLab HTTPS)
        → Frontend POST /api/projects { repoUrl }      [con JWT]
        → API valida JWT → valida URL → sandbox git clone
        → Proyecto aparece en la lista con UUID único
```

### 🆕 Abrir Terminal de un Proyecto (Página Dedicada)

```
Usuario → /dashboard → Click en "Abrir Terminal" de un proyecto
        → Navegación a /project/:projectId (SSR protegido)
        → Verificación server-side: el proyecto pertenece al usuario
        → Área principal: Dashboard con Comandos, Skills, Agents
        → Terminal colapsable en panel inferior
        → WebSocket autenticado con JWT → sandbox PTY
```

### 🆕 Gestión de Skills / Agents / Comandos

```
Usuario → /project/:id → Tabs principales
        → Tab "Comandos": accesos rápidos ejecutables en terminal
        → Tab "Skills": instrucciones/contexto con scope 📁 Proyecto o 🌐 Global
        → Tab "Agents": agentes IA con scope 📁 Proyecto o 🌐 Global
        → Items Globales se comparten entre TODOS los proyectos
        → Items de Proyecto son únicos para cada proyecto
```

### Modificar con OpenCode

```
Usuario → Selecciona proyecto → "Modificar"
        → Escribe prompt en lenguaje natural
        → Frontend POST /api/agent/run { projectId, prompt }  [con JWT]
        → API valida JWT → verifica projectId del usuario
        → API llama sandbox: opencode --path /workspace/projects/<uuid> --prompt "..."
        → Resultado streamado de vuelta al frontend
```

---

## Seguridad

### Modelo de amenaza

| Escenario de ataque | Resultado |
|---------------------|-----------|
| XSS en frontend | Sin acceso a API (JWT requerido) |
| JWT manipulado | Rechazado (JWKS real de Supabase) |
| Inyección en prompt | Sandbox aislado, cap_drop ALL |
| Path traversal | Bloqueado en API antes del sandbox |
| Compromiso del sandbox | Solo afecta `/workspace/projects` |
| Escalada de privilegios | Imposible (no-new-privileges + user no-root) |
| 🆕 Acceso no autorizado al terminal | JWT requerido en WebSocket + verificación owner |
| 🆕 Acceso por URL directa a /project/:id | SSR middleware verifica sesión + ownership |
| 🆕 Intento de tunnel sin auth | Token JWT validado en cada conexión WS |

### Medidas implementadas

1. **JWT verificado con JWKS** — No se confía en el token sin verificación criptográfica
2. **`Bun.spawn()` con Array** — Nunca concatenación de strings en shell
3. **Path Guard** — Toda ruta resulta en `path.resolve()` + `startsWith(base)`
4. **cap_drop: ALL** — Sin capacidades Linux en sandbox
5. **Usuario no-root** — El sandbox corre como `sandboxuser`
6. **Red interna** — API y sandbox sin puertos expuestos al host
7. **CORS estricto** — API solo acepta origen del frontend
8. **Rate limiting** — En API para prevenir DoS
9. **Timeout** — Comandos del sandbox con límite de tiempo
10. 🆕 **Middleware Astro SSR** — Verificación de sesión en TODAS las rutas protegidas
11. 🆕 **Ownership check server-side** — `/project/:id` verifica que el proyecto pertenece al usuario
12. 🆕 **WebSocket JWT** — Token pasado vía query param (estándar para WS), validado ANTES del upgrade
13. 🆕 **RLS en Supabase** — Row Level Security para skills/agents/commands
14. 🆕 **Terminal limpia por defecto** — Sin herramientas preinstaladas, el usuario configura
15. 🆕 **HOME aislado por proyecto** — Cada proyecto tiene `$HOME` en `/workspace/projects/<id>/.home/`, garantizando que herramientas (OpenCode, MCPs, configs) NO se comparten entre proyectos

### 🏗 Aislamiento por Proyecto (Best Practice)

> **Patrón recomendado por Docker Docs:** Cada proyecto debe ser un sandbox independiente.
> Nuestra implementación: HOME aislado por proyecto dentro del mismo contenedor.

```
/workspace/projects/
├── proyecto-prod/
│   ├── (source code)
│   └── .home/          ← $HOME de ESTE proyecto
│       ├── .bashrc     ← Shell config independiente
│       ├── .opencode/  ← OpenCode instalado solo aquí
│       └── .config/    ← MCP configs (Supabase prod, Vercel prod...)
│
├── proyecto-dev/
│   ├── (source code)
│   └── .home/          ← $HOME de ESTE otro proyecto
│       ├── .bashrc     ← Shell config independiente
│       ├── .opencode/  ← OpenCode instalado solo aquí
│       └── .config/    ← MCP configs (Supabase dev, Vercel dev...)
```

**Caso de uso:** Un usuario tiene:
- **Proyecto A** → apunta a Supabase PROD y Vercel PROD via MCP
- **Proyecto B** → apunta a Supabase DEV y Vercel DEV via MCP

Cada proyecto configura sus propios MCP servers en `.home/.config/` sin interferencia.

---

## API Reference

### `POST /api/projects`
Añadir un proyecto (git clone).

**Headers:** `Authorization: Bearer <jwt>`

**Body:**
```json
{ "repoUrl": "https://github.com/user/repo" }
```

**Response:**
```json
{ "projectId": "uuid-v4", "path": "/workspace/projects/uuid-v4", "status": "cloned" }
```

---

### `GET /api/projects`
Listar proyectos del usuario autenticado.

**Headers:** `Authorization: Bearer <jwt>`

---

### `DELETE /api/projects/:id`
Eliminar un proyecto.

**Headers:** `Authorization: Bearer <jwt>`

---

### `POST /api/agent/run`
Ejecutar OpenCode sobre un proyecto.

**Headers:** `Authorization: Bearer <jwt>`

**Body:**
```json
{ "projectId": "uuid-v4", "prompt": "Añade tests unitarios al módulo auth" }
```

**Response (stream):** Server-Sent Events con la salida de OpenCode.

---

### 🆕 `GET /api/projects/:id/skills`
Listar skills de un proyecto.

### 🆕 `POST /api/projects/:id/skills`
Crear un skill.

### 🆕 `PUT /api/projects/:id/skills/:skillId`
Actualizar un skill.

### 🆕 `DELETE /api/projects/:id/skills/:skillId`
Eliminar un skill.

---

### 🆕 `GET /api/projects/:id/agents`
Listar agents de un proyecto.

### 🆕 `POST /api/projects/:id/agents`
Crear un agent.

### 🆕 `PUT /api/projects/:id/agents/:agentId`
Actualizar un agent.

### 🆕 `DELETE /api/projects/:id/agents/:agentId`
Eliminar un agent.

---

### 🆕 `GET /api/projects/:id/commands`
Listar comandos de un proyecto.

### 🆕 `POST /api/projects/:id/commands`
Crear un comando.

### 🆕 `PUT /api/projects/:id/commands/:commandId`
Actualizar un comando.

### 🆕 `DELETE /api/projects/:id/commands/:commandId`
Eliminar un comando.

---

## Desarrollo — Mejoras Planificadas

### 📌 Mejora 1: Página Dedicada por Proyecto (en vez de modal)

**Estado:** ✅ Completado

**Descripción:** Actualmente, al pulsar "Abrir Terminal" se abre un modal con la terminal xterm.js. La mejora consiste en navegar a una **página SSR dedicada** `/project/[id]` que contiene la terminal a pantalla completa.

**Tareas:**

- [ ] **T1.1** — Crear ruta dinámica `frontend/src/pages/project/[id].astro`
  - SSR con `Astro.params.id` para obtener el `projectId`
  - Auth guard server-side (verificar sesión con Supabase)
  - Verificación de ownership del proyecto (API call SSR)
  - Redirect a `/dashboard` si no autorizado o proyecto no encontrado
- [ ] **T1.2** — Modificar `dashboard.astro`: cambiar el botón "Abrir Terminal" para navegar a `/project/:id` en lugar de abrir modal
  - Eliminar todo el HTML/CSS/JS del modal de terminal del dashboard
  - Mantener el modal de "Añadir Proyecto" como está
- [ ] **T1.3** — Diseñar layout de la página `/project/[id]`
  - Header con: nombre del proyecto, URL del repo, botón "Volver al Dashboard", estado de conexión
  - Área principal: terminal xterm.js a pantalla completa
  - Sidebar lateral (ver Mejora 3)
- [ ] **T1.4** — Implementar la conexión WebSocket en la nueva página
  - Reutilizar la lógica actual de `openTerminal()` adaptada a la nueva página
  - Manejar reconexión automática si el WebSocket se cierra inesperadamente
  - Usar `@xterm/addon-web-links` para clicks en URLs
  - Usar `@xterm/addon-fit` para ajuste automático al contenedor

---

### 📌 Mejora 2: Terminal Limpia (Sin Instalaciones Previas)

**Estado:** ✅ Completado

**Descripción:** Cada proyecto debe arrancar con un terminal completamente limpio, sin herramientas preinstaladas ni botones de quick-launch. El usuario decide qué instalar y configurar por proyecto.

**Tareas:**

- [ ] **T2.1** — Eliminar la toolbar de "quick-launch" del terminal (botones OpenCode, Claude, ls)
  - Estos serán reemplazados por los "Comandos" personalizados del sidebar (Mejora 3)
- [ ] **T2.2** — Modificar `sandbox/Dockerfile`: eliminar herramientas preinstaladas innecesarias
  - Mantener solo: `git`, `bash`, `node-pty`, y las dependencias mínimas
  - Los usuarios instalarán lo que necesiten por proyecto vía terminal
- [ ] **T2.3** — Modificar `sandbox/agent.js`: el PTY arranca en un entorno limpio
  - ENV mínimo: `HOME`, `PATH`, `TERM`, `SHELL`, `USER`
  - No inyectar PS1 personalizado (dejar que el usuario lo configure)
  - No ejecutar ningún comando automático al iniciar la sesión
- [ ] **T2.4** — Crear un mensaje de bienvenida estilizado en el terminal al conectarse
  - Solo información útil: nombre del proyecto, ruta, conexión exitosa
  - No ejecutar comandos automáticamente

---

### 📌 Mejora 3: Sidebar de Skills, Agents y Comandos

**Estado:** ✅ Completado (frontend con localStorage, pending Supabase tables)

**Descripción:** La página `/project/[id]` tiene un sidebar lateral colapsable donde el usuario puede crear, editar y ejecutar:
- **Skills:** Archivos de instrucciones/contexto (como SKILL.md) que se inyectan al agente
- **Agents:** Configuraciones de agentes IA (system prompt, modelo, etc.)
- **Commands:** Comandos shell reutilizables que se ejecutan en el terminal con un click

**Tareas:**

- [ ] **T3.1** — Diseño del Sidebar
  - Sidebar colapsable con animación (ancho ~300px, colapsado ~48px)
  - 3 tabs: 📋 Skills | 🤖 Agents | ⚡ Commands
  - Botón toggle en la barra superior del terminal
  - Responsive: en móvil se superpone como drawer
- [ ] **T3.2** — Backend: rutas CRUD para skills
  - `GET/POST /api/projects/:id/skills`
  - `PUT/DELETE /api/projects/:id/skills/:skillId`
  - Validación: el proyecto debe pertenecer al usuario (JWT)
  - Almacenamiento: archivo JSON en `/workspace/projects/<uuid>/.opencode/skills.json` o tabla Supabase
- [ ] **T3.3** — Backend: rutas CRUD para agents
  - `GET/POST /api/projects/:id/agents`
  - `PUT/DELETE /api/projects/:id/agents/:agentId`
  - Campos: name, description, systemPrompt, model
- [ ] **T3.4** — Backend: rutas CRUD para commands
  - `GET/POST /api/projects/:id/commands`
  - `PUT/DELETE /api/projects/:id/commands/:commandId`
  - Campos: name, command, description, icon, keybinding
- [ ] **T3.5** — Frontend: componente `Sidebar.tsx`
  - Estado de tab activa, estado de colapso
  - Transición suave con CSS `transform: translateX()`
- [ ] **T3.6** — Frontend: componente `SkillsPanel.tsx`
  - Lista de skills con nombre, descripción, preview del contenido
  - Modal/inline editor para crear/editar (textarea con markdown)
  - Botón eliminar con confirmación
- [ ] **T3.7** — Frontend: componente `AgentsPanel.tsx`
  - Lista de agents configurados
  - Formulario: name, description, system_prompt (textarea), model (select)
  - Botón "Ejecutar con este agent" → abre input de prompt
- [ ] **T3.8** — Frontend: componente `CommandsPanel.tsx`
  - Lista de comandos con nombre, icono, comando
  - Click en un comando → ejecuta en el terminal activo (envía por WS)
  - Crear/editar: name, command, description, icon (emoji picker), keybinding
  - Comandos de ejemplo predefinidos: `npm install`, `git status`, `ls -la`
- [ ] **T3.9** — Crear tablas Supabase para persistencia (ver SQL arriba)
  - Habilitar RLS en todas las tablas
  - Políticas: solo `auth.uid() = user_id`
- [ ] **T3.10** — Integración sidebar ↔ terminal
  - Los comandos se envían al terminal vía WebSocket al hacer click
  - Los skills se muestran como contexto cuando se ejecuta un agente
  - Keybindings opcionales para comandos frecuentes

---

### 📌 Mejora 4: Seguridad — Solo el Usuario Registrado Tiene Acceso

**Estado:** ✅ Completado (middleware, ownership, security headers)

**Descripción:** Garantizar que **solo el usuario autenticado propietario** de un proyecto pueda acceder a su terminal y recursos. Preparar el sistema para un futuro tunnel a dominio público.

**Tareas:**

- [ ] **T4.1** — Crear `frontend/src/middleware.ts` (Astro Middleware)
  - Interceptar TODAS las peticiones a rutas protegidas (`/dashboard`, `/project/*`)
  - Verificar sesión de Supabase server-side con `getUser()` (no `getSession()`)
  - Redirect a `/login` si no autenticado
  - Pasar `user` al `Astro.locals` para uso en páginas
  - Rutas públicas excluidas: `/login`, `/`, archivos estáticos
- [ ] **T4.2** — Verificación de ownership en `/project/[id].astro`
  - Antes de renderizar, hacer request SSR al API: `GET /projects`
  - Verificar que el `projectId` existe Y pertenece al `user.id`
  - Si no → `Astro.redirect('/dashboard')` con mensaje de error
- [ ] **T4.3** — Reforzar autenticación WebSocket en API
  - Actual: JWT pasado como query param `?token=` → **Mantener** (estándar para WS)
  - Añadir: verificar `exp` (expiración) del token antes de upgrade
  - Añadir: rate limit específico para conexiones WS por usuario
  - Añadir: log de auditoría (userId, projectId, IP, timestamp)
- [ ] **T4.4** — Preparar seguridad para tunnel público (futuro)
  - Asegurar que CORS solo permite el dominio del frontend (no `*`)
  - Implementar CSP headers (Content-Security-Policy)
  - Añadir `X-Frame-Options: DENY` para prevenir clickjacking
  - Añadir `X-Content-Type-Options: nosniff`
  - Añadir `Strict-Transport-Security` HSTS header
  - Implementar CSRF protection para mutaciones
- [ ] **T4.5** — Sanitización de datos del sidebar
  - Validar inputs de skills/agents/commands contra XSS
  - Escapar contenido antes de renderizar en el DOM
  - Limitar tamaño de campos (name: 100 chars, content: 50KB, command: 1000 chars)
- [ ] **T4.6** — Timeout y limpieza de sesiones
  - WebSocket: timeout de inactividad (configurable, default 1h)
  - Cleanup de PTY cuando WS se cierra
  - Limitar sesiones concurrentes por usuario (max 3)
- [ ] **T4.7** — Test de seguridad manual
  - [ ] Intentar acceder a `/project/:id` sin sesión → debe redirigir a `/login`
  - [ ] Intentar acceder a `/project/:id` con sesión de otro usuario → debe redirigir a `/dashboard`
  - [ ] Intentar conectar WebSocket sin token → debe rechazar (401)
  - [ ] Intentar conectar WebSocket con token de otro usuario → debe rechazar (403)
  - [ ] Intentar path traversal en projectId → debe rechazar (400)
  - [ ] Verificar que en producción solo puerto 80 está expuesto
  - [ ] Verificar headers de seguridad (CSP, HSTS, X-Frame-Options)

---

## Roadmap

- [ ] MVP: Clone + Run OpenCode básico ✅
- [ ] Streaming de output en tiempo real (SSE) ✅
- [ ] Terminal interactiva WebSocket (PTY) ✅
- [x] ✅ Página dedicada por proyecto (Mejora 1)
- [x] ✅ Terminal limpia sin preinstalaciones (Mejora 2)
- [x] ✅ Sidebar de Skills/Agents/Comandos (Mejora 3)
- [x] ✅ Seguridad reforzada para tunnel público (Mejora 4)
- [x] ✅ HOME aislado por proyecto — Multi-proyecto sin contaminación
- [x] ✅ Layout rediseñado: dashboard principal + terminal colapsable
- [x] ✅ Skills/Agents con scope Global y Per-Project
- [ ] Historial de operaciones por proyecto
- [ ] Multi-usuario con aislamiento por `userId`
- [ ] Soporte para ramas Git
- [ ] Persistencia sidebar en Supabase (migrar de localStorage)
- [ ] gVisor / Firecracker para sandbox más fuerte
- [ ] Seccomp profile personalizado
