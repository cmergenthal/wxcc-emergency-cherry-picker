import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptClaimedWebRtcCall } from '../webrtc.js';

test('WebRTC Accept calls the SDK only for the matching current voice task', async () => {
  let calls = 0;
  const actions = { getTaskMap: async () => new Map([['claimed', { interaction: { mediaType: 'telephony' } }]]), acceptWebRtcCall() { calls++; } };
  await acceptClaimedWebRtcCall(actions, 'claimed');
  assert.equal(calls, 1);
  await assert.rejects(acceptClaimedWebRtcCall(actions, 'another'), /single current voice task/);
  assert.equal(calls, 1);
});

test('No offer, multiple voice tasks, and unsupported SDK never answer', async () => {
  await assert.rejects(acceptClaimedWebRtcCall({}, 'claimed'), /does not expose/);
  for (const tasks of [new Map(), new Map([['claimed', {}], ['other', {}]])]) {
    await assert.rejects(acceptClaimedWebRtcCall({ getTaskMap: async () => tasks, acceptWebRtcCall() { assert.fail('Must not answer'); } }, 'claimed'), /single current voice task/);
  }
});

test('SDK answer errors reach the UI caller', async () => {
  await assert.rejects(acceptClaimedWebRtcCall({ getTaskMap: async () => new Map([['claimed', {}]]), acceptWebRtcCall() { throw new Error('Browser call unavailable'); } }, 'claimed'), /Browser call unavailable/);
});
