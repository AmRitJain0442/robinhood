import test from 'node:test';
import assert from 'node:assert/strict';
import { Secrets, terminalText } from '../src/privacy.js';

test('credentials split at every possible stream boundary never reach the terminal', () => {
  const key = 'example-secret-credential';
  const input = `before ${key} after ${key}`;
  for (let split = 0; split <= input.length; split++) {
    const secrets = new Secrets(); secrets.add(key);
    let output = '';
    const stream = secrets.stream(text => { output += text; });
    stream.write(input.slice(0, split));
    stream.write(input.slice(split));
    stream.flush();
    assert.equal(output, 'before [REDACTED] after [REDACTED]');
  }
});

test('overlapping known credentials are redacted across single-character chunks', () => {
  const secrets = new Secrets(); secrets.add('abcd'); secrets.add('abcd-efgh');
  let output = '';
  const stream = secrets.stream(text => { output += text; });
  for (const character of 'abcd-efgh abcd abcd-efgh') stream.write(character);
  stream.flush();
  assert.equal(output, '[REDACTED] [REDACTED] [REDACTED]');
});

test('untrusted output cannot emit terminal escape or clipboard control sequences', () => {
  assert.equal(terminalText('\x1b]52;c;secret\x07hello\x1b[2J\nworld'), 'hello\nworld');
  for (const text of ['\x1b]', '\x9b2J', '\x1b[31', '\rhidden']) assert.doesNotMatch(terminalText(text), /[\x00-\x08\x0b-\x1f\x7f-\x9f]/);
});
