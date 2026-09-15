import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Compatible } from '../src/providers/compatible.js';
import { groq } from '../src/providers/specs/groq.js';

test('Groq sends its documented token field, requires consent, and preserves foreign receipts', async () => {
  const requests: Record<string, unknown>[] = [];
  const model = groq.models[0]!;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    if (req.url === '/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: model.id }] })); return; }
    let body = ''; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body) as Record<string, unknown>);
    res.setHeader('content-type', 'text/event-stream');
    res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Receipt received.' }, finish_reason: 'stop' }], x_groq: { usage: { prompt_tokens: 40, completion_tokens: 4 } } })}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const route = new Compatible(groq, 'fixture-key', `http://127.0.0.1:${(server.address() as { port: number }).port}`).route(model.id);
    await assert.rejects(route.complete([], new AbortController().signal, () => {}), /approval/);
    const reply = await route.complete([
      { role: 'assistant', source: { provider: 'gemini', model: 'gemini-3.8-flash' }, content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'run_command', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'old', content: 'completed once' },
    ], new AbortController().signal, () => {}, { confirmed: true });
    assert.equal(requests.length, 1);
    assert.equal(requests[0]!.max_completion_tokens, 2048);
    assert.equal(requests[0]!.max_tokens, undefined);
    assert.match(JSON.stringify(requests[0]!.messages), /completed once/);
    assert.equal(reply.usage!.inputTokens, 40);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('Mistral discovers only active chat models with declared function support', async () => {
  const { mistral } = await import('../src/providers/specs/mistral.js');
  let posts = 0;
  const server = createServer(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer fixture-key');
    if (req.url === '/models') {
      res.setHeader('content-type', 'application/json');
      const model = { id: 'devstral-latest', max_context_length: 128000, capabilities: { completion_chat: true, function_calling: true } };
      res.end(JSON.stringify({ data: [model, { ...model, id: 'archived', archived: true }, { ...model, id: 'no-tools', capabilities: { completion_chat: true } }, { ...model, id: 'bad-context', max_context_length: -1 }] })); return;
    }
    posts++;
    let body = ''; for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    assert.equal(request.max_tokens, 2048);
    assert.equal(request.tools[0].type, 'function');
    res.setHeader('content-type', 'text/event-stream');
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'Abc123xyz', function: { name: 'read_file', arguments: '{"path":"README.md"}' } }] }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const client = new Compatible(mistral, 'fixture-key', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
    assert.deepEqual(await client.models(), [{ id: 'devstral-latest', context: 128000 }]);
    await assert.rejects(client.route('archived').complete([], new AbortController().signal, () => {}, { confirmed: true }), /supported model/);
    assert.equal(posts, 0);
    const reply = await client.route('devstral-latest').complete([], new AbortController().signal, () => {}, { confirmed: true });
    assert.equal(reply.message.tool_calls?.[0]?.id, 'Abc123xyz');
    assert.equal(posts, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
