import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl } from '../lib/fetch.mjs';

test('assertPublicUrl blocks IPv4-mapped IPv6 hosts with a private tail', () => {
  for (const u of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:10.0.0.5]/']) {
    assert.throws(() => assertPublicUrl(u), /blocked|private/i, u);
  }
});

test('assertPublicUrl blocks the unspecified IPv6 host', () => {
  assert.throws(() => assertPublicUrl('http://[::]/'), /blocked|private/i);
});

test('assertPublicUrl allows a public IPv4-mapped IPv6 host', () => {
  assert.equal(assertPublicUrl('http://[::ffff:8.8.8.8]/'), 'http://[::ffff:808:808]/');
});

test('assertPublicUrl allows a plain domain that starts with fc', () => {
  assert.equal(assertPublicUrl('https://fcexample.com/'), 'https://fcexample.com/');
});

test('assertPublicUrl still blocks the existing private hosts', () => {
  for (const u of ['http://127.0.0.1/admin', 'http://localhost:3000/x', 'http://10.0.0.5/a', 'http://192.168.1.1/a', 'http://172.16.0.9/a', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/a', 'http://[fe80::1]/a', 'http://[fd00::1]/a']) {
    assert.throws(() => assertPublicUrl(u), /blocked|private/i, u);
  }
});
