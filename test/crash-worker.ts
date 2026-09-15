// Invoked by recovery.test.ts in a disposable workspace, never by the product.
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { Store } from '../src/storage.js';
import { Runner } from '../src/session.js';
import { fixtureCommand } from '../src/demo.js';
import { workspaceIdentity } from '../src/tools.js';
import type { Route } from '../src/types.js';

const workspace = process.argv[2]!;
const store = new Store(path.join(workspace, '.robinhood', 'sessions.db'));
const session = store.create(workspace, await workspaceIdentity(workspace), 'Crash after the side effect, before the completion receipt.');
await writeFile(path.join(workspace, 'session-id.txt'), session.id);
const route: Route = {
  id: 'crash-fixture', provider: 'fixture', model: 'fixture',
  complete: async () => ({ message: { role: 'assistant', content: null, tool_calls: [{ id: 'crash-call', type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: fixtureCommand }) } }] } }),
};
// Inject the failure exactly between command completion and durable receipt write.
store.finish = () => { process.exit(91); };
await new Runner(store).turn(session, 'Start.', [route], { text() {}, status() {}, approve: async () => true }, new AbortController().signal);
process.exit(92); // Reaching this point means the injected crash did not happen.
