import { Store } from '../src/storage.js';
const store = new Store(process.argv[2]!);
const session = store.create(process.argv[3]!, 'fixture', 'Child task');
const [op] = store.prepare(session.id, { role: 'assistant', content: null, tool_calls: [{ id: 'child-call', type: 'function', function: { name: 'run_command', arguments: '{}' } }] });
store.running(op!.id);
process.send!({ session: session.id, operation: op!.id });
process.on('message', () => process.exit(91));
