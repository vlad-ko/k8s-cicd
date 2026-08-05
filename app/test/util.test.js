const { test } = require('node:test');
const assert = require('node:assert');
const { clientIp } = require('../lib/util');

const req = (headers) => ({ headers });

test('clientIp prefers the platform x-real-ip', () => {
  assert.strictEqual(clientIp(req({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.2.3.4' })), '203.0.113.7');
});

test('clientIp ignores a spoofed left-most x-forwarded-for and takes the right-most (platform-appended) entry', () => {
  // An attacker prepends a fake IP; the real edge IP is appended last by the proxy.
  assert.strictEqual(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1, 203.0.113.9' })), '203.0.113.9');
});

test('clientIp trims whitespace', () => {
  assert.strictEqual(clientIp(req({ 'x-real-ip': '  203.0.113.7  ' })), '203.0.113.7');
});

test('clientIp falls back to "unknown" when no headers are present', () => {
  assert.strictEqual(clientIp(req({})), 'unknown');
});

test('clientIp ignores an empty x-real-ip and uses x-forwarded-for', () => {
  assert.strictEqual(clientIp(req({ 'x-real-ip': '   ', 'x-forwarded-for': '203.0.113.5' })), '203.0.113.5');
});
