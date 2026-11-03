import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQueues, loadAvailableTransferQueues, voiceTasks, transferThenClaim, configuredTransferWrapup } from '../queue-transfer.js';
const active = new Map([['active', { interaction: { mediaType: 'telephony', state: 'connected' } }]]);
const wrapped = new Map([['active', { interaction: { mediaType: 'telephony', state: 'wrapup' } }]]);
function setup(overrides = {}) {
  const calls = [];
  return { calls, args: { activeId: 'active', pickedId: 'picked', queueId: 'queue-1',
    getTasks: async () => active,
    checkPicked: async () => { calls.push('check'); },
    transfer: async (id, queue) => { calls.push(['transfer', id, queue]); return { data: { type: 'AgentVteamTransferred' } }; },
    claim: async id => { calls.push(['claim', id]); return { status: 202 }; },
    wait: async () => {}, maxChecks: 3, ...overrides } };
}
test('queues normalize SDK maps and objects and exclude digital channels', () => {
  assert.deepEqual(normalizeQueues({ Sales: { name: 'Sales', value: '1' }, Chat: { id: '2', name: 'Chat', channelType: 'chat' } }), [{ id: '1', name: 'Sales' }]);
  assert.equal(normalizeQueues(new Map([['1', { id: '1', name: 'Voice', channelType: 'TELEPHONY' }]]))[0].id, '1');
  assert.equal(voiceTasks(new Map([['chat', { interaction: { mediaType: 'chat' } }]])).length, 0);
});
test('transfer confirms, waits through wrap-up, then claims without answering', async () => {
  let reads = 0;
  const { args, calls } = setup({ getTasks: async () => ++reads === 1 ? active : reads === 2 ? wrapped : new Map() });
  assert.equal((await transferThenClaim(args)).status, 202);
  assert.deepEqual(calls, ['check', ['transfer', 'active', 'queue-1'], 'check', ['claim', 'picked']]);
});
test('transfer failure never claims the picked call', async () => {
  const { args, calls } = setup({ transfer: async () => ({ data: { type: 'AgentVteamTransferFailed', reason: 'Not allowed' } }) });
  await assert.rejects(transferThenClaim(args), /Not allowed/);
  assert.deepEqual(calls, ['check']);
});
test('changed active call and stale picked call stop before transfer', async () => {
  for (const override of [{ getTasks: async () => new Map() }, { checkPicked: async () => { throw new Error('No longer queued'); } }]) {
    const { args, calls } = setup(override);
    await assert.rejects(transferThenClaim(args));
    assert.equal(calls.some(call => Array.isArray(call)), false);
  }
});
test('uncleared task times out without claiming; another offered voice call also blocks', async () => {
  const { args, calls } = setup();
  await assert.rejects(transferThenClaim(args), /did not clear/);
  assert.equal(calls.some(call => call[0] === 'claim'), false);
  let reads = 0;
  args.getTasks = async () => ++reads === 1 ? active : new Map([['other', { interaction: { mediaType: 'telephony' } }]]);
  await assert.rejects(transferThenClaim(args), /another voice task/);
});
test('disconnect or failed claim after transfer leaves explicit status without retry', async () => {
  let connected = true;
  const { args, calls } = setup({ isConnected: () => connected, transfer: async () => { connected = false; return { type: 'AgentVteamTransferred' }; } });
  await assert.rejects(transferThenClaim(args), /widget closed/);
  assert.equal(calls.some(call => call[0] === 'claim'), false);
  let reads = 0;
  const failure = setup({ getTasks: async () => ++reads === 1 ? active : new Map(), claim: async () => { throw new Error('Already assigned'); } });
  await assert.rejects(transferThenClaim(failure.args), /first call was transferred.*Already assigned/);
});

const queueResponse = { type: 'VteamList', data: { data: { vteamList: [
  { id: '7', name: 'Support', channelType: 'telephony', type: 'inboundqueue' },
  { id: '8', name: 'Chat', channelType: 'chat', type: 'inboundqueue' },
  { id: '9', name: 'Entry', channelType: 'telephony', type: 'inboundentrypoint' }
] } } };
test('documented nested queue response excludes digital queues and entry points', () => {
  assert.deepEqual(normalizeQueues(queueResponse), [{ id: '7', name: 'Support' }]);
  assert.deepEqual(normalizeQueues('unexpected'), []);
});
test('queue discovery requests fresh transfer targets using public agent session data', async () => {
  const desktop = { agentStateInfo: { latestData: { agentProfileID: 'profile', agentSessionId: 'session' } },
    agentContact: { async vteamList(request) {
      assert.deepEqual(request, { data: { agentProfileId: 'profile', agentSessionId: 'session',
        channelType: 'telephony', type: 'inboundqueue', trackingId: 'tracking' } });
      return queueResponse;
    } } };
  assert.deepEqual(await loadAvailableTransferQueues(desktop, () => 'tracking'), [{ id: '7', name: 'Support' }]);
  desktop.agentContact.vteamList = async () => ({ type: 'VteamListFailed', reason: 'Not allowed' });
  await assert.rejects(loadAvailableTransferQueues(desktop, () => 'tracking'), /Not allowed/);
  desktop.agentContact.vteamList = async () => undefined;
  await assert.rejects(loadAvailableTransferQueues(desktop, () => 'tracking'), /confirmed transfer queue list/);
  desktop.agentContact.vteamList = async () => ({ type: 'VteamList', data: { data: { vteamList: [] } } });
  assert.deepEqual(await loadAvailableTransferQueues(desktop, () => 'tracking'), []);
});
test('missing agent identity uses populated cache or reports session readiness', async () => {
  const desktop = { agentStateInfo: { latestData: {} }, actions: { async getMediaTypeQueue() { return []; } } };
  await assert.rejects(loadAvailableTransferQueues(desktop), /Desktop profile ID/);
  desktop.actions.getMediaTypeQueue = async () => queueResponse;
  assert.deepEqual(await loadAvailableTransferQueues(desktop), [{ id: '7', name: 'Support' }]);
});

test('granular state event session can supply identity missing from latestData', async () => {
  const desktop = { agentStateInfo: { latestData: { agentProfileID: 'profile' } },
    actions: { async getMediaTypeQueue() { return []; } },
    agentContact: { async vteamList({ data }) {
      assert.equal(data.agentSessionId, 'event-session');
      return queueResponse;
    } } };
  await assert.rejects(loadAvailableTransferQueues(desktop), /current agent session ID/);
  assert.deepEqual(await loadAvailableTransferQueues(desktop, () => 'tracking', { agentSessionId: 'event-session' }),
    [{ id: '7', name: 'Support' }]);
});

test('queues survive ringing to answered cache loss and component-local state loss', async () => {
  const desktop = { agentStateInfo: { latestData: { agentProfileID: 'profile' } },
    actions: { async getMediaTypeQueue() { return queueResponse; } } };
  const expected = [{ id: '7', name: 'Support' }];
  assert.deepEqual(await loadAvailableTransferQueues(desktop, undefined, { ownerToken: 'agent-a' }), expected);
  desktop.actions.getMediaTypeQueue = async () => [];
  // New component: no session ID or queue list retained on the caller.
  assert.deepEqual(await loadAvailableTransferQueues(desktop, undefined, { ownerToken: 'agent-a' }), expected);
  await assert.rejects(loadAvailableTransferQueues(desktop, undefined, { ownerToken: 'agent-b' }), /current agent session ID/);
});
test('confirmed empty list or denied request invalidates remembered queues', async () => {
  for (const reply of [{ type: 'VteamList', data: { data: { vteamList: [] } } }, { type: 'VteamListFailed' }]) {
    const desktop = { agentStateInfo: { latestData: { agentProfileID: 'profile' } },
      actions: { async getMediaTypeQueue() { return queueResponse; } },
      agentContact: { async vteamList() { return reply; } } };
    const scope = { ownerToken: 'agent' };
    await loadAvailableTransferQueues(desktop, undefined, scope);
    desktop.actions.getMediaTypeQueue = async () => [];
    desktop.agentStateInfo.latestData.agentSessionId = 'session';
    if (reply.type === 'VteamListFailed') await assert.rejects(loadAvailableTransferQueues(desktop, () => 'id', scope));
    else assert.deepEqual(await loadAvailableTransferQueues(desktop, () => 'id', scope), []);
    delete desktop.agentStateInfo.latestData.agentSessionId;
    await assert.rejects(loadAvailableTransferQueues(desktop, undefined, scope), /current agent session ID/);
  }
});

test('remembered queues cannot cross a known session or profile change', async () => {
  for (const change of [{ agentProfileID: 'other' }, { agentSessionId: 'other' }]) {
    const desktop = { agentStateInfo: { latestData: { agentProfileID: 'profile', agentSessionId: 'session' } },
      agentContact: { async vteamList() { return queueResponse; } },
      actions: { async getMediaTypeQueue() { return []; } } };
    const scope = { ownerToken: 'agent' };
    await loadAvailableTransferQueues(desktop, () => 'id', scope);
    desktop.agentStateInfo.latestData = change;
    await assert.rejects(loadAvailableTransferQueues(desktop, () => 'id', scope));
  }
});

test('automatic wrap-up runs once after transfer and before capacity clears and claim', async () => {
  let reads = 0;
  const { args, calls } = setup({ maxChecks: 5, getTasks: async () => ++reads === 1 ? active : reads < 5 ? wrapped : new Map() });
  args.wrapup = async id => { calls.push(['wrapup', id]); return { data: { type: 'AgentWrappedUp' } }; };
  await transferThenClaim(args);
  assert.deepEqual(calls, ['check', ['transfer', 'active', 'queue-1'], ['wrapup', 'active'], 'check', ['claim', 'picked']]);
});
test('wrap-up event works with lagging task state; failed wrap-up never claims or retries', async () => {
  let attempts = 0;
  const { args, calls } = setup({ isWrappingUp: id => id === 'active', wrapup: async () => {
    attempts++; return { type: 'AgentWrapupFailed' };
  } });
  await assert.rejects(transferThenClaim(args), /automatic wrap-up failed/);
  assert.equal(attempts, 1);
  assert.deepEqual(calls, ['check', ['transfer', 'active', 'queue-1']]);
});
test('automatic wrap-up is skipped when old task already cleared or transfer fails', async () => {
  for (const failed of [true, false]) {
    let reads = 0;
    const { args } = setup({ getTasks: async () => ++reads === 1 ? active : new Map(),
      wrapup: async () => assert.fail('must not wrap up a cleared task') });
    if (failed) {
      args.transfer = async () => ({ type: 'AgentVteamTransferFailed' });
      await assert.rejects(transferThenClaim(args));
    } else await transferThenClaim(args);
  }
});
test('configured automatic wrap-up validates config and submits exact V2 payload', async () => {
  const desktop = { agentContact: { async wrapupV2(payload) {
    assert.deepEqual(payload, { interactionId: 'old-call', data: { auxCodeId: 'code', wrapUpReason: 'Transferred', isAutoWrapup: true } });
    return { type: 'AgentWrappedUp' };
  } } };
  assert.equal(configuredTransferWrapup(desktop, {}), undefined);
  assert.throws(() => configuredTransferWrapup(desktop, { autoWrapUpOnTransfer: true }), /Configure/);
  const wrap = configuredTransferWrapup(desktop, { autoWrapUpOnTransfer: true, wrapUpCodeId: 'code', transferWrapUpReason: 'Transferred' });
  assert.equal((await wrap('old-call')).type, 'AgentWrappedUp');
});
