/**
 * Sandbox Agent — HTTP + WebSocket PTY
 *
 * HTTP endpoints:
 *  - GET  /health       → estado del servicio
 *  - POST /clone        → git clone
 *  - POST /run          → OpenCode (SSE)
 *  - DELETE /delete     → rm -rf proyecto
 *
 * WebSocket endpoint:
 *  - WS /terminal?projectId=xxx → terminal interactiva (PTY real)
 *    Mensajes entrada: JSON { type:'input', data:'...' } o { type:'resize', cols:N, rows:N }
 *    Mensajes salida: strings de texto del PTY (binarios con colores ANSI)
 *
 * SEGURIDAD:
 *  - Nunca ejecutar shell strings — siempre spawn con Array de args
 *  - guardPath() verifica que el path está dentro de WORKSPACE_BASE
 *  - Usuario no-root (enforced en Dockerfile)
 */

'use strict';

const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer } = require('ws');
const pty = require('node-pty');

const PORT = parseInt(process.env.PORT || '4000', 10);
const WORKSPACE_BASE = '/workspace/projects';
const GIT_TIMEOUT_MS = 5 * 60 * 1000;
const AGENT_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINAL_TIMEOUT_MS = 60 * 60 * 1000; // 1 hora por sesión

// ─── Path guard ───────────────────────────────────────────────────
function guardPath(projectId) {
  if (!projectId || typeof projectId !== 'string') {
    throw new Error('Invalid projectId');
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(projectId)) {
    throw new Error('Invalid projectId format');
  }
  const fullPath = path.resolve(WORKSPACE_BASE, projectId);
  if (!fullPath.startsWith(WORKSPACE_BASE + path.sep) && fullPath !== WORKSPACE_BASE) {
    throw new Error(`Path traversal attempt: ${fullPath}`);
  }
  return fullPath;
}

/**
 * Creates and returns a per-project isolated HOME directory.
 * Each project gets its own .home/ directory within its workspace,
 * ensuring installed tools, configs, and MCPs are completely independent.
 *
 * Structure: /workspace/projects/<projectId>/.home/
 *   ├── .bashrc
 *   ├── .opencode/    (installed per-project)
 *   ├── .config/      (MCP configs per-project)
 *   └── ...           (any other tool configs)
 */
function getProjectHome(projectId) {
  const projectPath = guardPath(projectId);
  const projectHome = path.join(projectPath, '.home');
  if (!fs.existsSync(projectHome)) {
    fs.mkdirSync(projectHome, { recursive: true });
    const bashrc = [
      '# OpenCode Agent — Per-project shell config',
      '# Tools installed here only affect THIS project',
      '',
      '# Project-local PATH: tools installed in .home take priority',
      'export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"',
      '',
      '# Clean prompt showing project context',
      'export PS1="\\[\\033[01;32m\\]sandbox\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ "',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(projectHome, '.bashrc'), bashrc);
  }
  return projectHome;
}

/**
 * Returns env vars for a project-specific isolated environment.
 * HOME points to the project's .home dir, so any tool install
 * (opencode, npm global, etc.) stays within this project only.
 */
function getProjectEnv(projectId, extra = {}) {
  const projectHome = getProjectHome(projectId);
  return {
    HOME: projectHome,
    USER: 'sandboxuser',
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    LANG: 'C.UTF-8',
    PATH: `${projectHome}/.opencode/bin:${projectHome}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
    ...extra,
  };
}

// ─── Spawn helper (NUNCA shell strings) ──────────────────────────
function spawnCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[sandbox] spawn: ${cmd} ${args.join(' ')}`);
    const proc = spawn(cmd, args, {
      shell: false,
      env: opts.env || {
        HOME: '/home/sandboxuser',
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        GIT_TERMINAL_PROMPT: '0',
      },
      ...opts,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (d) => { stdout += d.toString(); });
    proc.stderr?.on('data', (d) => { stderr += d.toString(); });
    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`Command timed out after ${opts.timeout || GIT_TIMEOUT_MS}ms`));
    }, opts.timeout || GIT_TIMEOUT_MS);
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Command failed (exit ${code}): ${stderr || stdout}`));
    });
    proc.on('error', (err) => { clearTimeout(timeout); reject(err); });
  });
}

function spawnStream(cmd, args, opts = {}) {
  console.log(`[sandbox] spawn-stream: ${cmd} ${args.join(' ')}`);
  return spawn(cmd, args, {
    shell: false,
    env: opts.env || { HOME: '/home/sandboxuser', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin' },
    ...opts,
  });
}

// ─── HTTP Server ──────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method.toUpperCase();
  console.log(`[sandbox] ${method} ${url.pathname}`);

  async function parseBody() {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk.toString(); });
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('Invalid JSON body')); } });
      req.on('error', reject);
    });
  }

  function json(data, status = 200) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  function error(message, status = 500) { json({ message }, status); }

  // ── Health ────────────────────────────────────────────────────
  if (url.pathname === '/health' && method === 'GET') {
    return json({ status: 'ok', workspace: WORKSPACE_BASE });
  }

  // ── List ──────────────────────────────────────────────────────
  if (url.pathname === '/list' && method === 'GET') {
    try {
      const projects = [];
      if (fs.existsSync(WORKSPACE_BASE)) {
        const dirs = fs.readdirSync(WORKSPACE_BASE, { withFileTypes: true });
        for (const dirent of dirs) {
          if (!dirent.isDirectory()) continue;
          const projectId = dirent.name;
          const gitConfigPath = path.join(WORKSPACE_BASE, projectId, '.git', 'config');
          let repoUrl = '';
          if (fs.existsSync(gitConfigPath)) {
            const config = fs.readFileSync(gitConfigPath, 'utf8');
            const match = config.match(/url = (.*)/);
            if (match) repoUrl = match[1].trim();
          }
          projects.push({ projectId, repoUrl });
        }
      }
      return json({ projects });
    } catch (e) {
      console.error('[sandbox] list error:', e.message);
      return error(`List failed: ${e.message}`, 500);
    }
  }

  // ── Clone ─────────────────────────────────────────────────────
  if (url.pathname === '/clone' && method === 'POST') {
    let body;
    try { body = await parseBody(); } catch (e) { return error(e.message, 400); }
    const { projectId, repoUrl } = body;
    let projectPath;
    try { projectPath = guardPath(projectId); } catch (e) { return error(e.message, 400); }
    if (fs.existsSync(projectPath)) return error('Project directory already exists', 409);
    try {
      await spawnCommand('git', ['clone', '--depth=1', repoUrl, projectPath]);
      return json({ status: 'cloned', path: projectPath });
    } catch (e) {
      console.error('[sandbox] clone error:', e.message);
      try { fs.rmSync(projectPath, { recursive: true, force: true }); } catch { }
      return error(`Clone failed: ${e.message}`, 422);
    }
  }

  // ── Run Agent (OpenCode con SSE) ──────────────────────────────
  if (url.pathname === '/run' && method === 'POST') {
    let body;
    try { body = await parseBody(); } catch (e) { return error(e.message, 400); }
    const { projectId, prompt } = body;
    let projectPath;
    try { projectPath = guardPath(projectId); } catch (e) { return error(e.message, 400); }
    if (!fs.existsSync(projectPath)) return error('Project directory not found', 404);

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
    function sendEvent(data) { res.write(`data: ${data}\n\n`); }

    let proc;
    const projEnv = getProjectEnv(projectId);
    const projHome = projEnv.HOME;
    const isOpenCodeInstalled = fs.existsSync(path.join(projHome, '.opencode/bin/opencode')) || fs.existsSync('/usr/local/bin/opencode');
    if (isOpenCodeInstalled) {
      proc = spawnStream('opencode', ['--path', projectPath, '--prompt', prompt, '--no-interactive'], { cwd: projectPath, env: projEnv });
    } else {
      proc = spawnStream('node', ['-e', `
        const fs = require('fs'); const path = require('path');
        const projectPath = ${JSON.stringify(projectPath)};
        const prompt = ${JSON.stringify(prompt)};
        console.log('=== OpenCode Agent (simulación) ===');
        console.log('Proyecto: ' + projectPath);
        console.log('Prompt recibido: ' + prompt);
        function listFiles(dir, prefix = '') {
          try { const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries.slice(0, 20)) {
              if (e.name.startsWith('.') || e.name === 'node_modules') continue;
              console.log(prefix + (e.isDirectory() ? '📁 ' : '📄 ') + e.name);
              if (e.isDirectory() && prefix.length < 4) listFiles(path.join(dir, e.name), prefix + '  ');
            }
          } catch (e) {}
        }
        console.log('Estructura del proyecto:'); listFiles(projectPath);
        console.log('\\nAnalizando código... (OpenCode procesaría tu instrucción aquí)');
        console.log('✓ Análisis completado. Instala OpenCode para modificaciones reales.');
      `]);
    }

    const timeout = setTimeout(() => { proc.kill('SIGKILL'); sendEvent('[DONE]'); res.end(); }, AGENT_TIMEOUT_MS);
    proc.stdout?.on('data', (chunk) => { for (const line of chunk.toString().split('\n')) { if (line) sendEvent(line); } });
    proc.stderr?.on('data', (chunk) => { for (const line of chunk.toString().split('\n')) { if (line) sendEvent(`[stderr] ${line}`); } });
    proc.on('close', (code) => { clearTimeout(timeout); sendEvent(`[Exit code: ${code}]`); sendEvent('[DONE]'); res.end(); });
    proc.on('error', (err) => { clearTimeout(timeout); sendEvent(`[ERROR] ${err.message}`); sendEvent('[DONE]'); res.end(); });
    return;
  }

  // ── Delete ────────────────────────────────────────────────────
  if (url.pathname === '/delete' && method === 'DELETE') {
    let body;
    try { body = await parseBody(); } catch (e) { return error(e.message, 400); }
    const { projectId } = body;
    let projectPath;
    try { projectPath = guardPath(projectId); } catch (e) { return error(e.message, 400); }
    if (!fs.existsSync(projectPath)) return json({ status: 'not_found' });
    try { fs.rmSync(projectPath, { recursive: true, force: true }); return json({ status: 'deleted' }); }
    catch (e) { return error(`Delete failed: ${e.message}`, 500); }
  }

  return error('Not found', 404);
});

// ─── WebSocket PTY Server ─────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/terminal' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const projectId = url.searchParams.get('projectId');

  console.log(`[terminal] New WS connection for project: ${projectId}`);

  // Validar path del proyecto
  let projectPath;
  try {
    projectPath = guardPath(projectId);
  } catch (err) {
    ws.send(`\r\n\x1b[31mError: ${err.message}\x1b[0m\r\n`);
    ws.close(1008, err.message);
    return;
  }

  // Verificar que el directorio existe
  if (!fs.existsSync(projectPath)) {
    ws.send(`\r\n\x1b[31mError: Project directory not found\x1b[0m\r\n`);
    ws.close(1008, 'Project not found');
    return;
  }

  // Usar bash si está disponible (instalado en el Dockerfile), si no sh
  const shell = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';

  let ptyProcess;
  try {
    // Per-project isolated HOME: tools/configs installed here stay in THIS project only
    const projEnv = getProjectEnv(projectId, { SHELL: shell });
    console.log(`[terminal] Project HOME: ${projEnv.HOME}`);

    ptyProcess = pty.spawn(shell, ['--rcfile', path.join(projEnv.HOME, '.bashrc')], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: projectPath,
      env: projEnv,
    });
  } catch (err) {
    console.error('[terminal] Failed to spawn PTY:', err.message);
    ws.send(`\r\n\x1b[31mError starting terminal: ${err.message}\x1b[0m\r\n`);
    ws.close();
    return;
  }

  console.log(`[terminal] PTY spawned PID=${ptyProcess.pid} shell=${shell} cwd=${projectPath}`);

  // PTY → WebSocket (salida del terminal al browser)
  ptyProcess.onData((data) => {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(data);
    }
  });

  // WebSocket → PTY (input del browser al terminal)
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'input') {
        ptyProcess.write(msg.data);
      } else if (msg.type === 'resize') {
        const cols = Math.max(10, Math.min(500, parseInt(msg.cols) || 80));
        const rows = Math.max(2, Math.min(200, parseInt(msg.rows) || 24));
        ptyProcess.resize(cols, rows);
      }
    } catch {
      // Si no es JSON válido, tratar como input directo
      ptyProcess.write(data.toString());
    }
  });

  // Timeout de sesión inactiva
  const sessionTimeout = setTimeout(() => {
    ws.send('\r\n\x1b[33m[Session timeout - 1 hour]\x1b[0m\r\n');
    cleanup();
  }, TERMINAL_TIMEOUT_MS);

  function cleanup() {
    clearTimeout(sessionTimeout);
    try { ptyProcess.kill(); } catch { }
    if (ws.readyState === 1) ws.close();
  }

  ws.on('close', () => {
    console.log(`[terminal] WS closed for PID=${ptyProcess.pid}`);
    cleanup();
  });

  ws.on('error', (err) => {
    console.error(`[terminal] WS error: ${err.message}`);
    cleanup();
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[terminal] PTY exited code=${exitCode}`);
    clearTimeout(sessionTimeout);
    if (ws.readyState === 1) {
      ws.send(`\r\n\x1b[33m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
      ws.close();
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🔒 Sandbox agent running on http://0.0.0.0:${PORT}`);
  console.log(`🖥️  Terminal WebSocket: ws://0.0.0.0:${PORT}/terminal`);
  console.log(`📁 Workspace: ${WORKSPACE_BASE}`);
  console.log(`👤 Running as: ${os.userInfo().username}`);
});
