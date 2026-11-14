import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { GET as handleChatGet, POST as handleChatPost } from './api/chat';

for (const envFile of ['.env.local', '.env']) {
  if (existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // Ignore unreadable env files
    }
  }
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolveBody, rejectBody) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > 100_000) {
        rejectBody(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolveBody(Buffer.concat(chunks)));
    req.on('error', rejectBody);
  });
}

async function handleApiChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    let webRes: Response;
    if (req.method === 'GET') {
      webRes = handleChatGet();
    } else if (req.method === 'POST') {
      const body = await readBody(req);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const url = `http://${req.headers.host || 'localhost:3000'}${req.url || '/api/chat'}`;
      const webReq = new Request(url, {
        method: 'POST',
        headers,
        body: new Uint8Array(body),
      });
      webRes = await handleChatPost(webReq);
    } else {
      res.statusCode = 405;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'method_not_allowed' }));
      return;
    }

    res.statusCode = webRes.status;
    webRes.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    const arrayBuffer = await webRes.arrayBuffer();
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: err instanceof Error ? err.message : 'internal_error' }));
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string): void {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname;
  const safeRelative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = resolve(distDir, safeRelative);

  let target = join(distDir, 'index.html');
  if (candidate.startsWith(distDir) && existsSync(candidate) && statSync(candidate).isFile()) {
    target = candidate;
  }

  const ext = extname(target).toLowerCase();
  res.statusCode = 200;
  res.setHeader('content-type', MIME_TYPES[ext] || 'application/octet-stream');
  res.end(readFileSync(target));
}

async function start(): Promise<void> {
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT) || 3000;
  const distDir = resolve('dist');

  const vite = isProd
    ? null
    : await (await import('vite')).createServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });

  const server = createHttpServer((req, res) => {
    const pathname = new URL(req.url || '/', 'http://localhost').pathname;
    if (pathname === '/api/chat') {
      void handleApiChat(req, res);
      return;
    }

    if (vite) {
      vite.middlewares(req, res);
    } else {
      serveStatic(req, res, distDir);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`welcomeRo server listening on http://localhost:${port}`);
  });
}

void start();
