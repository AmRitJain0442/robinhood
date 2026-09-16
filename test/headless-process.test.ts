import test from 'node:test';
import assert from 'node:assert/strict';
import { minimalEnvironment, runHeadless } from '../src/bridges/headless-process.js';

test('headless requests carry literal prompts on stdin without shell interpretation', async () => {
  const prompt = '$(touch unwanted) `commands` "quotes"\nUnicode: \u{1f600}';
  const output = await runHeadless({ command: process.execPath, args: ['-e', 'process.stdin.pipe(process.stdout)'], cwd: process.cwd(), env: minimalEnvironment(), input: prompt }, AbortSignal.timeout(5000));
  assert.equal(output, prompt);
  assert.ok(!Object.keys(minimalEnvironment()).some(key => /KEY|TOKEN|SECRET|PASSWORD/.test(key)));
});

test('headless requests stop on cancellation and excessive output', async () => {
  const request = { command: process.execPath, args: ['-e', 'setInterval(()=>{},1000)'], cwd: process.cwd(), env: minimalEnvironment(), input: '' };
  await assert.rejects(runHeadless(request, AbortSignal.timeout(200)), /cancelled|timed out/);
  await assert.rejects(runHeadless({ ...request, args: ['-e', 'process.stdout.write("x".repeat(2*1024*1024)); setInterval(()=>{},1000)'] }, AbortSignal.timeout(5000)), /exceeded/);
});
