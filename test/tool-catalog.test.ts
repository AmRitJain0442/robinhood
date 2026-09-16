import test from 'node:test';
import assert from 'node:assert/strict';
import { GeminiCliBridge } from '../src/bridges/gemini-cli.js';
import { engineCompletion, structuredSchema } from '../src/bridges/opencode.js';

test('per-request tool catalogs reach CLI bridges and reject tools outside the catalog', async () => {
  const tools = [{ type: 'function', function: { name: 'todo_list', parameters: { type: 'object' } } }];
  let prompt = '';
  const bridge = new GeminiCliBridge({ run: async (_model, text) => {
    prompt = text;
    return JSON.stringify({ response: JSON.stringify({ content: '', tool_calls: [{ name: 'todo_list', arguments: '{}' }] }) });
  } });
  const reply = await bridge.route('gemini-2.5-flash').complete([], AbortSignal.timeout(1000), () => {}, { confirmed: true }, { tools });
  assert.match(prompt, /todo_list/);
  assert.ok(!prompt.includes('write_file'));
  assert.equal(reply.message.tool_calls?.[0]?.function.name, 'todo_list');
  assert.deepEqual(structuredSchema(tools).properties.tool_calls.items.properties.name.enum, ['todo_list']);
  assert.throws(() => engineCompletion({ info: { structured: { content: '', tool_calls: [{ name: 'write_file', arguments: '{}' }] } } }, 'test', tools), /unsupported tool/);
});
