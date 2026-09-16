import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadMcp, loadPlugin, listSkills, loadSkill } from '../src/extensions.js';
import { Capabilities } from '../src/capabilities.js';
import { Store } from '../src/storage.js';

test('real MCP stdio tools enter the approval boundary and resources can be read', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-mcp-')));
  const config = path.join(root, 'mcp.json'), receipt = path.join(root, 'receipt.txt');
  await writeFile(config, JSON.stringify({ name: 'fixture', command: process.execPath, args: [fileURLToPath(new URL('./mcp-fixture.js', import.meta.url)), receipt] }));
  const capabilities = new Capabilities(); const store = new Store(path.join(root, 'state.db'));
  try {
    await loadMcp(config, capabilities, AbortSignal.timeout(10000));
    const session = store.create(root, 'fixture', 'MCP task');
    const tool = await capabilities.prepare({ store, session }, 'fixture__write', '{"content":"once"}');
    await assert.rejects(readFile(receipt));
    assert.match(await tool.execute(AbortSignal.timeout(5000)), /once/);
    assert.equal(await readFile(receipt, 'utf8'), 'once');
    const resource = await capabilities.prepare({ store, session }, 'fixture__read_resource', '{"uri":"fixture://note"}');
    assert.match(await resource.execute(AbortSignal.timeout(5000)), /Resource fixture/);
    store.event(session.id, 'plan-mode', true);
    await assert.rejects(capabilities.prepare({ store, session }, 'fixture__write', '{}'), /Plan mode/);
    await capabilities.unload('fixture');
    assert.ok(!capabilities.catalog(false).some(tool => tool.function.name.startsWith('fixture__')));
  } finally { await capabilities.close(); store.close(); }
});

test('workspace skills and trusted local plugins load without inventing permissions', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-extension-')));
  await mkdir(path.join(root, '.agents', 'skills', 'review'), { recursive: true });
  await writeFile(path.join(root, '.agents', 'skills', 'review', 'SKILL.md'), 'Inspect before editing.');
  assert.deepEqual(await listSkills(root), ['review']);
  assert.match(await loadSkill(root, 'review'), /Inspect/);
  await assert.rejects(loadSkill(root, '../escape'), /Select a skill/);
  const plugin = path.join(root, 'plugin.mjs');
  await writeFile(plugin, 'export default {name:"fixture",tools:[{name:"echo",description:"Echo",inputSchema:{type:"object"},execute:async(args)=>JSON.stringify(args)}]};');
  const capabilities = new Capabilities();
  try {
    assert.equal(await loadPlugin(plugin, capabilities), 'fixture');
    assert.ok(capabilities.catalog(false).some(tool => tool.function.name === 'fixture__echo'));
    assert.ok(!capabilities.catalog(true).some(tool => tool.function.name === 'fixture__echo'));
    await assert.rejects(loadPlugin(plugin, capabilities), /duplicate/);
  } finally { await capabilities.close(); }
});
