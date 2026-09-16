import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Approvals } from '../src/approvals.js';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { workspaceIdentity } from '../src/tools.js';
import type { Route } from '../src/types.js';

test('default YOLO executes an account-dependent tool round trip with zero permission questions', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-yolo-')));
  const store = new Store(path.join(root, 'state.db'));
  const decisions: boolean[] = [];
  const policy = new Approvals(undefined, async () => { throw new Error('YOLO must not ask for permission'); }, decision => decisions.push(decision.allowed));
  let requests = 0;
  try {
    const session = store.create(root, await workspaceIdentity(root), 'Create one test file');
    const route: Route = { id: 'fixture', provider: 'fixture', model: 'fixture', manualApproval: 'Account-dependent test route', complete: async (messages, _signal, _text, consent) => {
      assert.equal(consent?.confirmed, true);
      assert.ok(messages.some(message => message.content?.includes('YOLO mode:')));
      return { message: ++requests === 1 ? { role: 'assistant', content: '', tool_calls: [{ id: 'write-once', type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'result.txt', content: 'once', expectedHash: null }) } }] } : { role: 'assistant', content: 'Created.' } };
    } };
    await new Runner(store).turn(session, 'Create the file', [route], {
      approvalMode: 'yolo', text() {}, status() {},
      approve: (text, signal) => policy.confirm(text, signal),
      approveRequest: (text, signal) => policy.confirm(text, signal),
    }, AbortSignal.timeout(5000));
    assert.equal(await readFile(path.join(root, 'result.txt'), 'utf8'), 'once');
    assert.deepEqual(decisions, [true, true, true]);
    assert.equal(store.operations(session.id)[0]?.state, 'completed');
    assert.ok(store.events(session.id).some(event => event.kind === 'request-attempt' && (event.body as { approvalMode: string }).approvalMode === 'yolo'));
  } finally { store.close(); }
});

test('ask mode respects rejection and cancellation; switching to YOLO suppresses questions', async () => {
  let questions = 0;
  const policy = new Approvals('ask', async () => { questions++; return 'n'; });
  assert.equal(await policy.confirm('Write?', AbortSignal.timeout(1000)), false);
  policy.mode = 'yolo';
  assert.equal(await policy.confirm('Write?', AbortSignal.timeout(1000)), true);
  await assert.rejects(policy.confirm('Write?', AbortSignal.abort()), /abort/i);
  assert.equal(questions, 1);
});
