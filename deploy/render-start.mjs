// Single-service production launcher for Render (and container PaaS platforms).
// Serves built Angular static assets and proxies same-origin /api REST + /api/classroom-socket
// WebSocket traffic to the local NestJS process without logging request URLs, IPs, or ballots.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const clientRoot = path.join(root, 'apps/client/dist/client/browser');
const serverEntry = path.join(root, 'apps/server/dist/main.js');

assert.ok(
  fs.existsSync(path.join(clientRoot, 'index.html')),
  'Missing Angular production build at apps/client/dist/client/browser/index.html. Run "pnpm build" first.',
);
assert.ok(
  fs.existsSync(serverEntry),
  'Missing NestJS production build at apps/server/dist/main.js. Run "pnpm build" first.',
);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
};

const STRIPPED_IP_HEADERS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'x-client-ip',
  'forwarded',
];

function sanitizeHeaders(headers) {
  const clean = { ...headers };
  for (const header of STRIPPED_IP_HEADERS) {
    delete clean[header];
  }
  return clean;
}

async function allocateLoopbackPort() {
  const reserve = http.createServer();
  await new Promise((resolve, reject) => {
    reserve.once('error', reject);
    reserve.listen(0, '127.0.0.1', resolve);
  });
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  return port;
}

async function waitForHealth(origin, child) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) {
      throw new Error(`NestJS API exited during startup with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch {
      // Wait for NestJS to bind.
    }
    await sleep(50);
  }
  throw new Error('Timed out waiting for NestJS /api/health');
}

const publicPort = Number(process.env.PORT || 3000);
const publicHost = process.env.RENDER_BIND_HOST || '0.0.0.0';
const apiPort = await allocateLoopbackPort();
const apiOrigin = `http://127.0.0.1:${apiPort}`;

const apiEnv = {
  ...process.env,
  HOST: '127.0.0.1',
  PORT: String(apiPort),
  DATABASE_URL: '',
  SCENARIO_CONTENT_DIR: process.env.SCENARIO_CONTENT_DIR || path.join(root, 'content/scenarios'),
  SCENARIO_DATA_FILE:
    process.env.SCENARIO_DATA_FILE || path.join(root, 'apps/server/.data/scenarios.json'),
};

const apiChild = spawn(process.execPath, [serverEntry], {
  cwd: root,
  env: apiEnv,
  stdio: ['ignore', 'inherit', 'inherit'],
});

await waitForHealth(apiOrigin, apiChild);

const server = http.createServer((request, response) => {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(key, value);
  }

  const rawUrl = request.url || '/';
  if (rawUrl === '/api' || rawUrl.startsWith('/api/') || rawUrl.startsWith('/api?')) {
    const upstream = http.request(
      new URL(rawUrl, apiOrigin),
      {
        method: request.method,
        headers: sanitizeHeaders(request.headers),
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, {
          ...upstreamResponse.headers,
          ...SECURITY_HEADERS,
        });
        upstreamResponse.pipe(response);
      },
    );
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405);
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }

  if (pathname.split('/').some((segment) => segment.startsWith('.') && segment.length > 1)) {
    response.writeHead(404);
    response.end();
    return;
  }

  let file = path.resolve(clientRoot, '.' + pathname);
  if (file !== clientRoot && !file.startsWith(clientRoot + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }

  const existsAsFile = fs.existsSync(file) && fs.statSync(file).isFile();
  if (!existsAsFile) {
    // Missing JSON/static assets must return 404, never HTML SPA fallback.
    if (path.extname(pathname)) {
      response.writeHead(404);
      response.end();
      return;
    }
    file = path.join(clientRoot, 'index.html');
  }

  const ext = path.extname(file).toLowerCase();
  response.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
  if (ext === '.html' || ext === '.json') {
    response.setHeader('Cache-Control', 'no-cache');
  }
  response.writeHead(200);
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  fs.createReadStream(file).pipe(response);
});

server.on('upgrade', (request, socket, head) => {
  const rawUrl = request.url || '';
  if (
    rawUrl !== '/api/classroom-socket' &&
    !rawUrl.startsWith('/api/classroom-socket/') &&
    !rawUrl.startsWith('/api/classroom-socket?')
  ) {
    socket.destroy();
    return;
  }

  // Preserve original Host and Origin so ClassroomGateway's same-origin check succeeds.
  const upstream = http.request(new URL(rawUrl, apiOrigin), {
    headers: sanitizeHeaders(request.headers),
  });

  upstream.on('upgrade', (upstreamResponse, remote, remoteHead) => {
    const headerLines = Object.entries(upstreamResponse.headers)
      .map(([key, value]) =>
        Array.isArray(value)
          ? value.map((item) => `${key}: ${item}\r\n`).join('')
          : `${key}: ${value}\r\n`,
      )
      .join('');
    socket.write(
      `HTTP/1.1 ${upstreamResponse.statusCode || 101} Switching Protocols\r\n${headerLines}\r\n`,
    );
    if (head.length) remote.write(head);
    if (remoteHead.length) socket.write(remoteHead);
    remote.pipe(socket);
    socket.pipe(remote);
    remote.on('error', () => socket.destroy());
    socket.on('error', () => remote.destroy());
  });

  upstream.on('error', () => socket.destroy());
  upstream.end();
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => {
    apiChild.kill();
    process.exit(code);
  });
  setTimeout(() => {
    apiChild.kill('SIGKILL');
    process.exit(code);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
apiChild.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`NestJS API process exited unexpectedly with code ${code}`);
    shutdown(code || 1);
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(publicPort, publicHost, resolve);
});
console.log(`EDS Render gateway listening on http://${publicHost}:${publicPort}`);
