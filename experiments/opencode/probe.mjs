// An opt-in, account-free probe against a pinned OpenCode binary.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createOpencodeClient } from '@opencode-ai/sdk';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scratch = await mkdtemp(path.join(tmpdir(), 'robinhood opencode probe '));
const workspace = path.join(scratch, 'workspace with spaces');
await mkdir(workspace, { recursive: true });
await writeFile(path.join(workspace, 'README.md'), 'Disposable fixture. No user data.\n');
const requests = [];
const observations = { version: '1.18.31', platform: process.platform, scratch, checks: {} };
let proc;
let serverURL;
let authHeader;
let output = '';
let firstTool = true;

async function until(check, label, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}\n${output.slice(-3000)}`);
}

const mock = createServer(async (req, res) => {
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ url: req.url, model: body.model, messages: body.messages, at: Date.now() });
    if (body.model === 'fixture-a' && !firstTool) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '1' });
      res.end(JSON.stringify({ error: { message: 'Fixture quota exhausted', type: 'rate_limit_error' } }));
      return;
    }
    const tool = body.model === 'fixture-a';
    if (tool) firstTool = false;
    const delta = tool ? { tool_calls: [{ index: 0, id: 'fixture-write-once', type: 'function', function: {
      name: 'bash', arguments: JSON.stringify({ command: 'node -e "require(\'fs\').appendFileSync(\'receipt.txt\',\'once\\n\')"', description: 'Write the fixture receipt once' }),
    } }] } : { content: 'Continuation received the previous tool receipt.' };
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (part, finish = null) => ({ id: randomUUID(), object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: body.model, choices: [{ index: 0, delta: part, finish_reason: finish }] });
    res.write(`data: ${JSON.stringify(chunk({ role: 'assistant', ...delta }))}\n\n`);
    res.write(`data: ${JSON.stringify({ ...chunk({}, tool ? 'tool_calls' : 'stop'), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
    res.end('data: [DONE]\n\n');
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  }
});
mock.listen(0, '127.0.0.1');
await once(mock, 'listening');

async function api(route, method = 'GET', body) {
  const response = await fetch(`${serverURL}${route}`, {
    method, headers: { Authorization: authHeader, 'content-type': 'application/json', 'x-opencode-directory': encodeURIComponent(workspace) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${route}: ${response.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function stop() {
  if (!proc || proc.exitCode !== null) return;
  const exited = once(proc, 'exit');
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    await once(killer, 'exit');
  } else proc.kill('SIGTERM');
  await Promise.race([exited, new Promise((_, reject) => setTimeout(() => reject(new Error('Engine did not exit')), 5000).unref())]);
}

async function start() {
  output = '';
  const password = randomUUID();
  authHeader = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
  const model = { name: 'Fixture', limit: { context: 128000, output: 4096 }, tool_call: true };
  const config = {
    autoupdate: false, share: 'disabled', snapshot: false,
    enabled_providers: ['robinhood-fixture'], model: 'robinhood-fixture/fixture-a', small_model: 'robinhood-fixture/fixture-b',
    permission: { '*': 'ask' }, compaction: { auto: false, prune: false },
    provider: { 'robinhood-fixture': {
      npm: '@ai-sdk/openai-compatible', name: 'Loopback fixture',
      options: { baseURL: `http://127.0.0.1:${mock.address().port}/v1`, apiKey: 'fixture-not-a-real-key', maxRetries: 0 },
      models: { 'fixture-a': model, 'fixture-b': model },
    } },
  };
  // Deliberately do not inherit account credentials or the user's engine configuration.
  const env = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'PATHEXT']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  Object.assign(env, {
    HOME: scratch, USERPROFILE: scratch,
    XDG_CONFIG_HOME: path.join(scratch, 'config'), XDG_DATA_HOME: path.join(scratch, 'data'),
    XDG_CACHE_HOME: path.join(scratch, 'cache'), XDG_STATE_HOME: path.join(scratch, 'state'),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config), OPENCODE_SERVER_PASSWORD: password,
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true', OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true', OPENCODE_DISABLE_DEFAULT_PLUGINS: 'true',
  });
  const binary = path.join(fileURLToPath(new URL('.', import.meta.url)), 'node_modules', 'opencode-ai', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  proc = spawn(binary, ['serve', '--hostname=127.0.0.1', '--port=0'], { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stdout.on('data', data => { output += data; });
  proc.stderr.on('data', data => { output += data; });
  proc.on('error', error => { output += error.message; });
  serverURL = await until(() => output.match(/opencode server listening on (http:\/\/\S+)/)?.[1], 'engine start');
  return createOpencodeClient({ baseUrl: serverURL, directory: workspace, headers: { Authorization: authHeader }, throwOnError: true });
}

try {
  const client = await start();
  const { data: session } = await client.session.create({ body: { title: 'Explicit fixture title' } });
  assert.ok(session.id);
  const prompt = client.session.prompt({ path: { id: session.id }, body: { model: { providerID: 'robinhood-fixture', modelID: 'fixture-a' }, parts: [{ type: 'text', text: 'Run the fixture command exactly once.' }] } }).catch(error => ({ error: String(error) }));
  const permission = await until(async () => (await api('/permission')).find(item => item.sessionID === session.id), 'tool permission');
  assert.equal(await readFile(path.join(workspace, 'receipt.txt'), 'utf8').catch(() => null), null);
  observations.checks.permissionBeforeSideEffect = true;
  await api(`/permission/${permission.id}/reply`, 'POST', { reply: 'once' });
  await until(async () => await readFile(path.join(workspace, 'receipt.txt'), 'utf8').catch(() => null), 'command receipt');
  await until(() => requests.filter(r => r.model === 'fixture-a').length >= 3, 'engine retry despite maxRetries: 0');
  observations.checks.engineRetriesBeyondProviderSetting = true;
  await api(`/session/${session.id}/abort`, 'POST');
  await prompt;
  const beforeSwitch = await api(`/session/${session.id}/message`);
  observations.checks.durableCompletedTool = beforeSwitch.some(message => message.parts.some(part => part.type === 'tool' && part.state?.status === 'completed'));
  await client.session.prompt({ path: { id: session.id }, body: { model: { providerID: 'robinhood-fixture', modelID: 'fixture-b' }, parts: [{ type: 'text', text: 'Continue using the completed receipt. Do not repeat the command.' }] } });
  assert.equal(await readFile(path.join(workspace, 'receipt.txt'), 'utf8'), 'once\n');
  observations.checks.noCompletedCommandReplayOnManualSwitch = true;
  observations.checks.nextModelReceivedToolResult = requests.filter(r => r.model === 'fixture-b').some(r => r.messages?.some(m => m.role === 'tool'));
  await stop();
  await start();
  const restored = await api(`/session/${session.id}/message`);
  assert.ok(restored.length >= beforeSwitch.length);
  observations.checks.sessionSurvivesEngineRestart = true;
  observations.checks.authFileWritten = await readFile(path.join(scratch, 'data', 'opencode', 'auth.json'), 'utf8').then(() => true, () => false);
  observations.requests = requests.map(({ url, model }) => ({ url, model }));
  observations.result = 'completed';
} catch (error) {
  observations.result = 'failed';
  observations.error = String(error);
  process.exitCode = 1;
} finally {
  await stop();
  mock.closeAllConnections();
  await new Promise(resolve => mock.close(resolve));
  await mkdir(path.join(root, '.robinhood'), { recursive: true });
  await writeFile(path.join(root, '.robinhood', 'opencode-probe.json'), JSON.stringify(observations, null, 2) + '\n');
  console.log(JSON.stringify(observations, null, 2));
}
