import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Horde } from '../src/providers/horde.js';

test('Horde preserves text context, never executes model text as tools, and cancels its failed job', async () => {
  let posts = 0, deletes = 0, faulted = false;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url?.startsWith('/status/models')) { res.end(JSON.stringify([{ name: 'example', type: 'text', count: 1 }, { name: 'image', type: 'image', count: 2 }])); return; }
    assert.equal(req.headers.apikey, '0000000000');
    if (req.method === 'POST') {
      posts++; let raw = ''; for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      assert.match(body.prompt, /remember-this/);
      assert.equal(body.tools, undefined);
      assert.deepEqual(body.models, ['example']);
      res.end('{"id":"job-1"}'); return;
    }
    if (req.method === 'DELETE') { deletes++; res.end('{}'); return; }
    res.end(JSON.stringify({ done: true, faulted, generations: [{ state: 'ok', text: '{"tool_calls":["do-not-execute"]}' }] }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new Horde('', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    assert.equal((await client.models()).length, 1);
    const route = client.route('example'), messages = [{ role: 'user' as const, content: 'remember-this' }];
    await assert.rejects(route.complete(messages, new AbortController().signal, () => {}), /approval/);
    assert.equal(posts, 0);
    const reply = await route.complete(messages, new AbortController().signal, () => {}, { confirmed: true });
    assert.equal(reply.message.tool_calls, undefined);
    faulted = true;
    await assert.rejects(route.complete(messages, new AbortController().signal, () => {}, { confirmed: true }), /cannot complete/);
    assert.equal(posts, 2); assert.equal(deletes, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
