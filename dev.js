// Local stand-in for Vercel: serves public/ and api/*.js. Data is kept in
// memory unless BLOB_READ_WRITE_TOKEN points at a real Blob store.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { memoryBackend, setBackend } from './lib/store.js';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

export const useMemoryStore = () => setBackend(memoryBackend());

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) {
        const name = url.pathname.slice(5).replace(/[^a-z]/g, '');
        const mod = await import(pathToFileURL(join(ROOT, 'api', name + '.js'))).catch(() => null);
        const handler = mod?.[req.method];
        if (!handler) { res.writeHead(404).end('{"error":"Not found"}'); return; }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const r = await handler(new Request(url, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
        res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()));
        return;
      }
      const file = join(ROOT, 'public', url.pathname === '/' ? 'index.html' : normalize(url.pathname));
      if (!file.startsWith(join(ROOT, 'public'))) throw new Error('bad path');
      res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' }).end(await readFile(file));
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) useMemoryStore();
  const port = process.env.PORT || 3000;
  createServer().listen(port, () => console.log(`http://localhost:${port}`));
}
