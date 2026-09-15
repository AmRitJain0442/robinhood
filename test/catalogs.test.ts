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
