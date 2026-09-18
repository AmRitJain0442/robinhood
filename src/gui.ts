import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Terminal } from './ui/terminal.js';

export async function startGui(terminal: Terminal, dashboard: () => unknown) {
  const token = randomBytes(32).toString('hex');
  const html = await readFile(new URL('../../src/ui/gui.html', import.meta.url), 'utf8');
  let origin = '';
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const json = (status: number, data: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(data)); };
    if (request.headers.host !== origin.slice(7) || request.headers.origin && request.headers.origin !== origin) { json(403, { error: 'Local origin required.' }); return; }
    if (request.url === '/favicon.ico' && request.method === 'GET') { response.writeHead(204); response.end(); return; }
    if (request.url === '/' && request.method === 'GET') {
      const nonce = randomBytes(16).toString('hex');
      response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(html.replaceAll('__NONCE__', nonce)); return;
    }
    if (request.headers.authorization !== `Bearer ${token}`) { json(401, { error: 'Open the private GUI URL printed by Robinhood.' }); return; }
    try {
      if (request.method === 'GET' && request.url === '/api/state') { json(200, { terminal: terminal.snapshot(), dashboard: dashboard() }); return; }
      if (request.method !== 'POST') { json(404, { error: 'Not found.' }); return; }
      let body = '';
      for await (const chunk of request) { body += chunk.toString(); if (Buffer.byteLength(body) > 65536) { json(413, { error: 'Input too large.' }); return; } }
      const data = JSON.parse(body || '{}') as { value?: unknown; promptId?: unknown };
      if (request.url === '/api/input') {
        if (typeof data.value !== 'string' || typeof data.promptId !== 'number') throw new Error('Invalid input.');
        terminal.remoteSubmit(data.value, data.promptId);
      } else if (request.url === '/api/cancel') {
        if (terminal.snapshot().prompt?.label === 'You >') throw new Error('No active task to cancel.');
        const prompt = terminal.snapshot().prompt;
        if (prompt?.choices || prompt?.hidden) terminal.cancel();
        else terminal.interrupt();
      } else { json(404, { error: 'Not found.' }); return; }
      json(200, { ok: true });
    } catch (error) { json(409, { error: error instanceof Error ? error.message : 'Request failed.' }); }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('GUI failed to bind.');
  origin = `http://127.0.0.1:${address.port}`;
  return { url: `${origin}/#${token}`, origin, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
