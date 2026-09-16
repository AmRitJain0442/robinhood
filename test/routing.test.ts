import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RoutePool } from '../src/routing.js';
import { RouteError, type Connector, type Route } from '../src/types.js';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { workspaceIdentity } from '../src/tools.js';

const signal = () => AbortSignal.timeout(10000);
const ui = { text() {}, status() {}, approve: async () => true };
const route = (id: string, complete: Route['complete'] = async () => ({ message: { role: 'assistant', content: 'Done' } })): Route => ({ id, provider: id.split('/')[0]!, model: id, complete });
const connector = (id: string): Connector => ({ models: async () => [{ id: 'small', context: 8192 }, { id: 'large', context: 64000 }], route: model => route(`${id}/${model}`) });

test('discovery chains free catalogs, excludes unverified accounts, deduplicates and keeps the working model first', async () => {
  const connections = new Map([['openrouter', connector('openrouter')], ['kilo', connector('kilo')], ['groq', { ...connector('groq'), models: async () => { throw new Error('must not query unverified account'); } }]]);
  const pool = new RoutePool();
  const routes = await pool.discover(connections, route('openrouter/small'), 'kilo/large', signal(), () => {});
  assert.equal(routes.length, 4);
  assert.equal(routes[0]!.id, 'kilo/large');
  assert.ok(routes.every(item => item.provider !== 'groq'));
  pool.enabled = false;
  assert.deepEqual((await pool.discover(connections, route('groq/selected'), null, signal(), () => {})).map(item => item.id), ['groq/selected']);
});

test('quota cooldown honors retry-after, skips subsequent turns, then recovers', async () => {
  let now = 0;
  const pool = new RoutePool(() => now);
  const selected = route('fixture/model', async () => { throw new RouteError('quota', 'quota', 2000); });
  const discover = () => pool.discover(new Map(), selected, null, signal(), () => {});
  const [first] = await discover();
  await assert.rejects(first!.complete([], signal(), () => {}), /quota/);
  assert.equal((await discover()).length, 0);
  now = 2001;
  assert.equal((await discover()).length, 1);
});

test('unavailable catalogs do not block healthy providers; cancellation stops discovery', async () => {
  const connections = new Map([['openrouter', { ...connector('openrouter'), models: async () => { throw new Error('offline'); } }], ['kilo', connector('kilo')]]);
  const notices: string[] = [];
  assert.equal((await new RoutePool().discover(connections, undefined, null, signal(), text => notices.push(text))).length, 2);
  assert.equal(notices.length, 1);
  await assert.rejects(new RoutePool().discover(connections, undefined, null, AbortSignal.abort(), () => {}), /abort/i);
});

test('more than twelve failed routes reach a healthy model with saved context; policy denial never switches', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'robinhood-chain-')));
  const store = new Store(path.join(root, 'state.db'));
  try {
    const session = store.create(root, await workspaceIdentity(root), 'Finish the task');
    const failed = Array.from({ length: 15 }, (_, i) => route(`fixture/${i}`, async () => { throw new RouteError('exhausted', 'quota'); }));
    let calls = 0;
    const healthy = route('fixture/healthy', async messages => {
      calls++;
      assert.ok(messages.some(message => message.content === 'Keep this task'));
      return { message: { role: 'assistant', content: 'Finished' } };
    });
    await new Runner(store).turn(session, 'Keep this task', [...failed, healthy], ui, signal());
    assert.equal(store.events(session.id).filter(event => event.kind === 'route-handoff').length, 15);
    assert.equal(store.get(session.id).route, healthy.id);
    await new Runner(store).turn(session, undefined, [...failed, healthy], ui, signal());
    assert.equal(calls, 2);
    const denied = route('denied', async () => { throw new RouteError('denied', 'policy'); });
    store.selectRoute(session.id, denied.id);
    await assert.rejects(new Runner(store).turn(session, undefined, [denied, healthy], ui, signal()), /denied/);
    assert.equal(calls, 2);
  } finally { store.close(); }
});
