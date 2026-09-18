import test from 'node:test';
import assert from 'node:assert/strict';
import { Terminal } from '../src/ui/terminal.js';
import { Secrets } from '../src/privacy.js';
import { startGui } from '../src/gui.js';

test('GUI protects local controls, rejects stale prompts, and never echoes credentials', async () => {
  const terminal = new Terminal(new Secrets(), true);
  const gui = await startGui(terminal, () => ({ fixture: true }));
  const headers = { Authorization: `Bearer ${gui.url.split('#')[1]}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(`${gui.origin}/api/state`)).status, 401);
    assert.equal((await fetch(`${gui.origin}/api/state`, { headers: { ...headers, Origin: 'https://unrelated.example' } })).status, 403);
    const html = await fetch(gui.origin);
    assert.match(html.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.ok(!(await html.text()).includes(gui.url.split('#')[1]!));
    const answer = terminal.password('Fixture');
    const snapshot = await (await fetch(`${gui.origin}/api/state`, { headers })).json() as { terminal: { promptId: number } };
    const send = (promptId: number) => fetch(`${gui.origin}/api/input`, { method: 'POST', headers, body: JSON.stringify({ value: 'private-fixture-key', promptId }) });
    assert.equal((await send(snapshot.terminal.promptId - 1)).status, 409);
    assert.equal((await send(snapshot.terminal.promptId)).status, 200);
    assert.equal(await answer, 'private-fixture-key');
    assert.ok(!JSON.stringify(terminal.snapshot()).includes('private-fixture-key'));
    assert.equal((await send(snapshot.terminal.promptId)).status, 409);
  } finally { terminal.close(); await gui.close(); }
});
