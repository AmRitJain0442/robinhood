import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { browserLogin, openRouterFlow, puterFlow } from '../src/auth/browser.js';
import { AccountVault } from '../src/auth/vault.js';
import { filterChoices } from '../src/ui/terminal.js';
import { setupGuides, accountPriority } from '../src/auth/catalog.js';
import { providers } from '../src/providers/registry.js';

test('browser login rejects wrong callback paths and replay, exchanges only the accepted code', async () => {
  let callback = '';
  let exchanges = 0;
  const result = await browserLogin({ parameter: 'code', url: (url, verifier) => {
    callback = url; assert.ok(verifier.length >= 43); return url;
  }, exchange: async value => { exchanges++; return `credential:${value}`; } }, async url => {
    const wrong = new URL(url); wrong.pathname = '/callback/wrong'; wrong.searchParams.set('code', 'attacker');
    assert.equal((await fetch(wrong)).status, 404);
    assert.equal((await fetch(url)).status, 400);
    const valid = new URL(url); valid.searchParams.set('code', 'accepted');
    const response = await fetch(valid);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(valid)).status, 404);
  }, new AbortController().signal);
  assert.equal(result, 'credential:accepted'); assert.equal(exchanges, 1);
  await assert.rejects(fetch(callback));
});

test('browser login abort and provider denial close the listener without exchange', async () => {
  for (const deny of [false, true]) {
    const controller = new AbortController(); let callback = '';
    await assert.rejects(browserLogin({ parameter: 'code', url: url => url, exchange: async () => { assert.fail('must not exchange'); } }, async url => {
      callback = url;
      if (deny) await fetch(`${url}?error=access_denied`); else controller.abort();
    }, controller.signal), /cancelled|aborted/i);
    await assert.rejects(fetch(callback));
  }
});

test('OpenRouter uses S256 PKCE and Puter uses its documented authme callback', () => {
  const callback = 'http://127.0.0.1:12345/callback/random';
  const url = new URL(openRouterFlow.url(callback, 'verifier'));
  assert.equal(url.origin, 'https://openrouter.ai');
  assert.equal(url.searchParams.get('callback_url'), callback);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update('verifier').digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  const puter = new URL(puterFlow.url(callback, ''));
  assert.equal(puter.searchParams.get('redirectURL'), callback);
  assert.equal(puter.searchParams.get('action'), 'authme');
});

test('vault stores independent accounts and supports missing credentials and malformed data', async () => {
  const records = new Map<string, string>();
  const vault = new AccountVault((service, account) => {
    const id = `${service}/${account}`;
    return { getPassword: () => records.get(id), setPassword: value => { records.set(id, value); }, deletePassword: () => records.delete(id) };
  });
  await vault.remove('missing');
  assert.equal(await vault.load('missing'), undefined);
  await vault.save('a', { key: 'synthetic', method: 'browser' });
  await vault.save('b', { key: '', method: 'anonymous' });
  assert.equal((await vault.load('a'))?.key, 'synthetic');
  await vault.remove('a'); assert.equal(await vault.load('a'), undefined);
  assert.equal((await vault.load('b'))?.method, 'anonymous');
  records.set('robinhood.accounts.v1/b', 'null');
  await assert.rejects(vault.load('b'), /malformed/);
  const unavailable = new AccountVault(() => { throw new Error('OS vault unavailable'); });
  await assert.rejects(unavailable.save('x', { key: 'synthetic', method: 'key' }));
});

test('account picker searches names, IDs and connection methods case-insensitively', () => {
  const choices = [{ value: 'openrouter', label: 'OpenRouter', detail: 'browser sign-in' }, { value: 'kilo', label: 'Kilo', detail: 'anonymous' }];
  assert.deepEqual(filterChoices(choices, 'BROWSER'), [choices[0]]);
  assert.deepEqual(filterChoices(choices, 'kilo'), [choices[1]]);
  assert.deepEqual(filterChoices(choices, 'no match'), []);
});

test('every connector has HTTPS setup guidance and supported browser login comes first', () => {
  for (const provider of providers) assert.equal(new URL(setupGuides[provider.id]!).protocol, 'https:');
  assert.equal([...providers].sort((a, b) => accountPriority(a.id) - accountPriority(b.id))[0]?.id, 'openrouter');
});
