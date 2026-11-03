import test from 'node:test';
import assert from 'node:assert/strict';
import { postJson, mergeCallerIds, assignVoiceTask } from '../transport.js';

test('missing caller metadata stays retryable until a webhook arrives', () => {
  const cache = {};
  mergeCallerIds(cache, [{ InteractionId: 'call-1', found: false }]);
  assert.equal(Object.hasOwn(cache, 'call-1'), false);
  mergeCallerIds(cache, [{ InteractionId: 'call-1', found: true, ANI: '123' }]);
  assert.equal(cache['call-1'].ANI, '123');
});

test('state writes wait for a successful HTTP acknowledgement', async () => {
  let acknowledge;
  let finished = false;
  const pending = postJson('https://example.test/api/transfer-state.php', { command: 'transfer-hold' }, 'agent-token', async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer agent-token');
    assert.equal(JSON.parse(options.body).command, 'transfer-hold');
    await new Promise(resolve => { acknowledge = resolve; });
    return { ok: true, json: async () => ({ ok: true }) };
  }).then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  acknowledge();
  await pending;
  assert.equal(finished, true);
});

test('failed state writes reject instead of allowing a transfer to continue', async () => {
  await assert.rejects(postJson('https://example.test/api/transfer-state.php', {}, 'token', async () => ({
    ok: false, json: async () => ({ error: 'Storage unavailable' })
  })), /Storage unavailable/);
});


test('Claim accepts empty 202 without treating it as delivery', async () => {
  const result = await assignVoiceTask('https://api.example/', 'call-1', 'token', async (url, options) => {
    assert.equal(url, 'https://api.example/v1/tasks/call-1/assign');
    assert.equal(options.method, 'POST');
    return { ok: true, status: 202, text: async () => '' };
  });
  assert.equal(result.status, 202);
});

test('Claim reports Webex error detail and correlation reference', async () => {
  await assert.rejects(assignVoiceTask('https://api.example', 'call-1', 'token', async () => ({
    ok: false, status: 403, text: async () => JSON.stringify({ message: 'Manual assignment disabled' }),
    headers: { get: name => name === 'trackingid' ? 'ref-123' : null }
  })), /403.*Manual assignment disabled.*ref-123/);
});
