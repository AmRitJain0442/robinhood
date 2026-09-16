import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Compatible } from '../src/providers/compatible.js';
import { ai21 } from '../src/providers/specs/ai21.js';
import { boundedJSON, jsonCompletion } from '../src/providers/chat-completions.js';

test('AI21 disables streaming for tools and resumes with the original tool receipt', async () => {
  let posts = 0;
  const call = { id: 'read123ab', type: 'function', function: { name: 'read_file', arguments: '{"path":"README.md"}' } };
  const server = createServer(async (req, res) => {
    posts++;
    assert.equal(req.url, '/chat/completions');
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(body.stream, false);
    assert.equal(body.tool_choice, undefined);
    if (posts === 2) assert.equal(body.messages.at(-1).tool_call_id, call.id);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ finish_reason: posts === 1 ? 'tool_calls' : 'stop', message: posts === 1 ? { role: 'assistant', content: null, tool_calls: [call] } : { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 20, completion_tokens: 4 } }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const route = new Compatible(ai21, 'fixture-key', `http://127.0.0.1:${(server.address() as { port: number }).port}`).route('jamba-mini');
    await assert.rejects(route.complete([], new AbortController().signal, () => {}), /approval/);
    assert.equal(posts, 0);
    const reply = await route.complete([], new AbortController().signal, () => {}, { confirmed: true });
    assert.deepEqual(reply.message.tool_calls, [call]);
    reply.message.source = { provider: 'ai21', model: 'jamba-mini' };
    const final = await route.complete([reply.message, { role: 'tool', tool_call_id: call.id, content: 'file contents' }], new AbortController().signal, () => {}, { confirmed: true });
    assert.equal(final.message.content, 'done');
    assert.equal(final.usage?.inputTokens, 20);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('JSON completions reject truncation, malformed tools and oversized responses', async () => {
  for (const payload of [
    { choices: [{ finish_reason: 'length', message: { role: 'assistant', content: 'partial' } }] },
    { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', tool_calls: [{ type: 'function', id: 'x', function: { name: 'read_file', arguments: '{' } }] } }] },
    { choices: [{ finish_reason: 'stop', message: { role: 'user', content: 'wrong role' } }] },
  ]) assert.throws(() => jsonCompletion(payload, () => assert.fail('Invalid responses must not be emitted')));
  await assert.rejects(boundedJSON(new Response('x'.repeat(1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } })), /exceeded/);
});
