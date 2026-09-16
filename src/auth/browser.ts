import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { once } from 'node:events';
import open from 'open';
import { boundedJSON, object } from '../providers/chat-completions.js';

export async function openBrowser(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Browser sign-in requires HTTPS.');
  await open(url, { wait: false });
}

export interface BrowserFlow {
  url(callback: string, verifier: string): string;
  parameter: 'code' | 'token';
  exchange(value: string, verifier: string, signal: AbortSignal): Promise<string>;
}

export const openRouterFlow: BrowserFlow = {
  parameter: 'code',
  url: (callback, verifier) => {
    const url = new URL('https://openrouter.ai/auth');
    url.searchParams.set('callback_url', callback);
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.href;
  },
  async exchange(code, verifier, signal) {
    const data = object(await boundedJSON(await fetch('https://openrouter.ai/api/v1/auth/keys', {
      method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal,
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    })));
    if (typeof data.key !== 'string' || !data.key) throw new Error('OpenRouter did not return an account credential.');
    return data.key;
  },
};

// Same browser authme flow exposed by Puter's official Node getAuthToken helper.
// We add a private callback path, origin checks, cancellation and server cleanup.
export const puterFlow: BrowserFlow = {
  parameter: 'token',
  url: callback => `https://puter.com/?${new URLSearchParams({ action: 'authme', redirectURL: callback })}`,
  async exchange(token) { return token; },
};

export async function browserLogin(flow: BrowserFlow, launch: (url: string) => Promise<void>, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const verifier = randomBytes(32).toString('base64url');
  const nonce = randomBytes(32).toString('hex');
  let accept!: (value: string) => void;
  let reject!: (error: Error) => void;
  const received = new Promise<string>((resolve, fail) => { accept = resolve; reject = fail; });
  void received.catch(() => {});
  let claimed = false;
  let origin = '';
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    let url: URL;
    try { url = new URL(req.url ?? '/', origin); } catch { res.writeHead(400).end(); return; }
    const expectedPath = `/callback/${nonce}`;
    const validPath = Buffer.byteLength(url.pathname) === Buffer.byteLength(expectedPath) && timingSafeEqual(Buffer.from(url.pathname), Buffer.from(expectedPath));
    if (req.method !== 'GET' || req.headers.host !== new URL(origin).host || !validPath || claimed) { res.writeHead(404).end('Not found'); return; }
    const value = url.searchParams.get(flow.parameter);
    if (url.searchParams.has('error')) { claimed = true; res.writeHead(200).end('Sign-in was cancelled. Return to Robinhood.'); reject(new Error('Sign-in was cancelled by the provider.')); return; }
    if (!value || value.length > 16384 || /[\r\n]/.test(value)) { res.writeHead(400).end('Missing sign-in response.'); return; }
    claimed = true;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<!doctype html><html><title>Robinhood connected</title><body style="background:#101712;color:#eaf4eb;font:18px monospace;padding:12vh 12vw"><p style="color:#b5ef63">ROBINHOOD / ACCOUNT LINK</p><h1>Back to your terminal.</h1><p>Your sign-in response was received. Robinhood will finish linking your account.</p><p>You can close this tab.</p></body></html>');
    accept(value);
  });
  const abort = () => reject(new Error('Browser sign-in cancelled or timed out. Your existing connection was kept.'));
  const timed = AbortSignal.any([signal, AbortSignal.timeout(180000)]);
  timed.addEventListener('abort', abort, { once: true });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening', { signal: timed });
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await launch(flow.url(`${origin}/callback/${nonce}`, verifier));
    const value = await received;
    timed.throwIfAborted();
    return await flow.exchange(value, verifier, timed);
  } finally {
    timed.removeEventListener('abort', abort);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
