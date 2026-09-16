import test from 'node:test';
import assert from 'node:assert/strict';
import { Compatible } from '../src/providers/compatible.js';
import { vercel } from '../src/providers/specs/vercel.js';
import { createServer } from 'node:http';
import { once } from 'node:events';

test('Vercel filters media and unsupported models before inference', async () => {
  let posts = 0;
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      const model = { id: 'example/chat', type: 'language', context_window: 32000, supported_parameters: ['tools'] };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: [model, { ...model, id: 'image', type: 'image' }, { ...model, id: 'no-tools', supported_parameters: [] }] })); return;
    }
    posts++; res.setHeader('content-type', 'text/event-stream');
    res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new Compatible(vercel, 'fixture-key', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    assert.deepEqual(await client.models(), [{ id: 'example/chat', context: 32000 }]);
    await assert.rejects(client.route('image').complete([], new AbortController().signal, () => {}, { confirmed: true }), /supported model/);
    await client.route('example/chat').complete([], new AbortController().signal, () => {}, { confirmed: true });
    assert.equal(posts, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('Hugging Face pins a live tool-capable upstream and blocks it after withdrawal', async () => {
  const { huggingface } = await import('../src/providers/specs/huggingface.js');
  let live = true, posts = 0;
  const server = createServer(async (req, res) => {
    if (req.method === 'GET') {
      res.setHeader('content-type', 'application/json');
      const provider = { provider: 'novita', status: live ? 'live' : 'staging', context_length: 32000, supports_tools: true };
      res.end(JSON.stringify({ data: [{ id: 'example/model', providers: [provider, { ...provider, provider: 'no-tools', supports_tools: false }] }] })); return;
    }
    posts++;
    let raw = ''; for await (const chunk of req) raw += chunk;
    assert.equal(JSON.parse(raw).model, 'example/model:novita');
    res.setHeader('content-type', 'text/event-stream');
    res.end('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new Compatible(huggingface, 'fixture-key', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    assert.deepEqual(await client.models(), [{ id: 'example/model:novita', context: 32000 }]);
    const route = client.route('example/model:novita');
    await route.complete([], new AbortController().signal, () => {}, { confirmed: true });
    live = false;
    await assert.rejects(route.complete([], new AbortController().signal, () => {}, { confirmed: true }), /supported model/);
    assert.equal(posts, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('Cloudflare account configuration cannot change the destination host or path', async () => {
  const { cloudflare } = await import('../src/providers/specs/cloudflare.js');
  for (const account of ['', '../models', 'https://evil.example', 'a'.repeat(31)]) assert.throws(() => cloudflare(account), /account ID/);
  assert.equal(cloudflare('a'.repeat(32)).baseURL, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/ai/v1`);
});
