import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Compatible, type CompatibleSpec } from '../src/providers/compatible.js';

// Every reviewed static specification exercises the real transport and parser.
for (const file of await readdir(new URL('../src/providers/specs/', import.meta.url))) {
  if (!file.endsWith('.js')) continue;
  const module = await import(new URL(`../src/providers/specs/${file}`, import.meta.url).href);
  const specifications = file === 'cloudflare.js' ? [module.cloudflare('a'.repeat(32))] : Object.values(module);
  for (const spec of specifications as CompatibleSpec[]) {
    if (!spec.models?.length || spec.nonStreaming) continue;
    test(`${spec.name}: approved tool round-trip, portable memory, quota and interruption contract`, async () => {
      let requests = 0, posts = 0, mode = 'tool';
      const server = createServer(async (req, res) => {
        requests++;
        assert.equal(req.headers[(spec.keyHeader ?? 'authorization').toLowerCase()], spec.keyHeader ? 'fixture-key' : 'Bearer fixture-key');
        if (req.method === 'GET') {
          assert.equal(req.url, spec.modelsPath ?? '/models');
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ data: [{ id: spec.models[0]!.id }, { id: 'unsupported-model' }] })); return;
        }
        posts++;
        assert.equal(req.url, spec.completionPath ?? '/chat/completions');
        let raw = ''; for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw);
        assert.equal(body[spec.maxTokenField ?? 'max_tokens'], 2048);
        assert.equal(body.stream, true);
        assert.equal(body.tools[0].type, 'function');
        assert.equal(body.tool_choice, spec.omitToolChoice ? undefined : 'auto');
        assert.equal(body.model, spec.models[0]!.id);
        if (mode === 'quota') { res.writeHead(429, { 'retry-after': '9' }); res.end(); return; }
        res.setHeader('content-type', 'text/event-stream');
        if (mode === 'partial') { res.end('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'); return; }
        if (mode === 'tool') {
          assert.match(JSON.stringify(body.messages), /historical-receipt/);
          assert.equal(JSON.stringify(body.messages).includes('providerState'), false);
          res.end('data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call123ab","function":{"name":"read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n');
        } else {
          assert.equal(body.messages.at(-1).tool_call_id, 'call123ab');
          res.end('data: {"choices":[{"delta":{"content":"done"},"finish_reason":"stop"}],"usage":{"prompt_tokens":20,"completion_tokens":3}}\n\ndata: [DONE]\n\n');
        }
      });
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      try {
        const client = new Compatible(spec, 'fixture-key', `http://127.0.0.1:${(server.address() as { port: number }).port}`);
        const route = client.route(spec.models[0]!.id), signal = new AbortController().signal;
        await assert.rejects(route.complete([], signal, () => {}), /approval/);
        assert.equal(requests, 0);
        const first = await route.complete([
          { role: 'assistant', source: { provider: 'foreign', model: 'foreign' }, content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
          { role: 'tool', tool_call_id: 'old', content: 'historical-receipt' },
        ], signal, () => {}, { confirmed: true });
        assert.equal(first.message.tool_calls?.[0]?.function.name, 'read_file');
        mode = 'reply';
        first.message.source = { provider: spec.id, model: route.model };
        const reply = await route.complete([first.message, { role: 'tool', tool_call_id: 'call123ab', content: 'read result' }], signal, () => {}, { confirmed: true });
        assert.equal(reply.usage?.outputTokens, 3);
        mode = 'quota';
        await assert.rejects(route.complete([], signal, () => {}, { confirmed: true }), error => (error as { kind: string }).kind === 'quota');
        assert.equal(posts, 3);
        mode = 'partial';
        await assert.rejects(route.complete([], signal, () => {}, { confirmed: true }), /disconnected/);
        assert.equal(posts, 4);
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    });
  }
}
