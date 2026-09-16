import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Puter } from '../src/providers/puter.js';

test('Puter uses the reviewed driver envelope, normalizes tools, and stops on exhausted allowance', async () => {
  let posts = 0;
  const server = createServer(async (req, res) => {
    posts++;
    assert.equal(req.url, '/drivers/call');
    assert.equal(req.headers['content-type'], 'text/plain;actually=json');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.auth_token, 'fixture-token');
    assert.equal(body.interface, 'puter-chat-completion');
    assert.equal(body.driver, 'ai-chat');
    assert.equal(body.args.normalize, true);
    assert.equal(body.args.stream, false);
    assert.equal(body.args.provider, 'openai');
    res.setHeader('content-type', 'application/json');
    if (posts > 1) { res.end('{"success":false,"error":{"code":"insufficient_funds"}}'); return; }
    res.end(JSON.stringify({ success: true, result: { message: { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }, finish_reason: 'tool_calls', usage: { prompt_tokens: 20, completion_tokens: 5 } } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const route = new Puter('fixture-token', `http://127.0.0.1:${(server.address() as { port: number }).port}`).route('gpt-4o-mini');
    await assert.rejects(route.complete([], new AbortController().signal, () => {}), /approval/);
    assert.equal(posts, 0);
    const reply = await route.complete([], new AbortController().signal, () => {}, { confirmed: true });
    assert.equal(reply.message.tool_calls?.[0]?.function.name, 'read_file');
    assert.equal(reply.usage?.outputTokens, 5);
    await assert.rejects(route.complete([], new AbortController().signal, () => {}, { confirmed: true }), /allowance exhausted/);
    assert.equal(posts, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
