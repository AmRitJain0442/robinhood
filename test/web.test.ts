import test from 'node:test';
import assert from 'node:assert/strict';
import { publicAddress, fetchPublicPage } from '../src/web.js';

test('web fetch blocks local, metadata, mapped IPv6 and reserved destinations', async () => {
  for (const address of ['127.0.0.1', '10.0.0.2', '169.254.169.254', '172.16.1.2', '192.168.1.2', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', 'not-an-ip']) assert.equal(publicAddress(address), false, address);
  assert.equal(publicAddress('1.1.1.1'), true);
  assert.equal(publicAddress('2606:4700:4700::1111'), true);
  await assert.rejects(fetchPublicPage('http://127.0.0.1/', AbortSignal.timeout(1000)), /blocked/);
  await assert.rejects(fetchPublicPage('file:///etc/passwd', AbortSignal.timeout(1000)), /public HTTP/);
});
