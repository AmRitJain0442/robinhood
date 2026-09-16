import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompletion } from '../src/providers/chat-completions.js';
import { chatMessages } from '../src/providers/memory.js';

test('streamed continuation artifacts are reassembled only for the same provider and model', async () => {
  const chunks = [
    { choices: [{ delta: { reasoning_details: [{ index: 0, type: 'reasoning.encrypted', id: 'opaque-id', data: 'first-' }] } }] },
    { choices: [{ delta: { reasoning_details: [{ index: 0, data: 'second' }], reasoning_content: 'private-state' } }] },
    { choices: [{ delta: { content: 'visible', tool_calls: [{ index: 0, id: 'call1', function: { name: 'read_file', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] },
  ];
  const response = new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  let displayed = '';
  const { message } = await parseCompletion(response, text => { displayed += text; }, { provider: 'gateway', model: 'model-a' });
  message.source = { provider: 'gateway', model: 'model-a' };
  assert.equal(displayed, 'visible');
  const same = chatMessages([message], 'gateway', 'model-a')[0]!;
  assert.deepEqual(same.reasoning_details, [{ index: 0, type: 'reasoning.encrypted', id: 'opaque-id', data: 'first-second' }]);
  assert.equal(same.reasoning_content, 'private-state');
  for (const [provider, model] of [['gateway', 'model-b'], ['other', 'model-a']]) {
    const foreign = JSON.stringify(chatMessages([message, { role: 'tool', tool_call_id: 'call1', content: 'completed receipt' }], provider!, model!));
    assert.match(foreign, /completed receipt/);
    assert.doesNotMatch(foreign, /first-second|private-state|opaque-id/);
  }
});

test('typed text chunks are displayed without rendering thinking chunks', async () => {
  const frame = { choices: [{ delta: { content: [{ type: 'thinking', thinking: 'internal' }, { type: 'text', text: 'answer' }] }, finish_reason: 'stop' }] };
  let displayed = '';
  const reply = await parseCompletion(new Response(`data: ${JSON.stringify(frame)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }), text => { displayed += text; });
  assert.equal(displayed, 'answer');
  assert.equal(reply.message.content, 'answer');
});
