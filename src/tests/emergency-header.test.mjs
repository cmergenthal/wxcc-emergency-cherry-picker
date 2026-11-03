import test from 'node:test';
import assert from 'node:assert/strict';
import { newestEmergency, transferDestination, listEmergencyTasks, answerPickedOffer, takeEmergency, emergencyDiagnostics, configuredEmergencyQueue } from '../emergency-header.js';

const row = (id, time, overrides = {}) => ({ id, attributes: { status: 'queued', channelType: 'telephony', createdTime: time,
  origin: '+15551230000', queue: { id: 'emergency', name: 'Emergency Queue' }, ...overrides } });
const picked = row('picked', 100);
const activeTask = { interaction: { interactionId: 'active', mediaType: 'telephony', state: 'connected', currentVTeam: 'original-queue' } };
const settings = { queueName: 'Emergency Queue', emergencyTransferMode: 'original', wrapUpCodeId: 'code', transferWrapUpReason: 'Transferred' };

test('only newest waiting voice contact from the exact emergency queue appears', () => {
  const rows = [row('old', 1), row('new', 2), row('chat', 5, { channelType: 'chat' }), row('assigned', 6, { status: 'assigned' }),
    row('other', 7, { queue: { name: 'Other' } }), row('bad-time', 'bad')];
  assert.equal(newestEmergency(rows, settings).id, 'new');
  assert.equal(newestEmergency([row('wrong-case', 9, { queue: { name: 'emergency queue' } })], settings), null);
  assert.equal(newestEmergency([row('by-id', 3, { queue: { id: 'fixed' } })], { queueId: 'fixed' }).id, 'by-id');
  assert.equal(newestEmergency([]), null);
});

test('return destination uses current original queue or explicit configuration; unknown queue stops', () => {
  assert.equal(transferDestination(activeTask, settings), 'original-queue');
  assert.equal(transferDestination(activeTask, { emergencyTransferQueueId: 'fixed' }), 'fixed');
  assert.throws(() => transferDestination({}, settings), /original queue ID/);
  assert.throws(() => transferDestination(activeTask, { emergencyTransferMode: 'select' }), /Configure/);
});

test('task discovery follows pages and never forwards a token outside the API', async () => {
  let requests = 0;
  const rows = await listEmergencyTasks({ apiBase: 'https://api.test', from: 1, token: 'test', fetcher: async (url, request) => {
    assert.equal(request.headers.Authorization, 'Bearer test');
    requests++;
    return { ok: true, json: async () => ({ data: [row(`row-${requests}`, requests)],
      links: requests === 1 ? { next: '/v1/tasks?cursor=2' } : {} }) };
  } });
  assert.equal(rows.length, 2);
  requests = 0;
  await assert.rejects(listEmergencyTasks({ apiBase: 'https://api.test', from: 1, token: 'test', fetcher: async () => {
    requests++;
    return { ok: true, json: async () => ({ data: [], links: { next: 'https://elsewhere.test/v1/tasks' } }) };
  } }), /Invalid task pagination/);
  assert.equal(requests, 1);
});

test('browser answer waits for the exact picked offer; unrelated tasks and timeouts never answer', async () => {
  let answers = 0;
  let reads = 0;
  const desktop = { actions: { getTaskMap: async () => ++reads < 2 ? new Map() : new Map([['picked', { interaction: { mediaType: 'telephony', state: 'offered' } }]]),
    acceptWebRtcCall: async () => { answers++; } } };
  await answerPickedOffer({ desktop, taskId: 'picked', wait: async () => {}, maxChecks: 3 });
  assert.equal(answers, 1);
  desktop.actions.getTaskMap = async () => new Map([['other', { interaction: { mediaType: 'telephony', state: 'offered' } }]]);
  await assert.rejects(answerPickedOffer({ desktop, taskId: 'picked' }), /Another voice/);
  desktop.actions.getTaskMap = async () => new Map();
  await assert.rejects(answerPickedOffer({ desktop, taskId: 'picked', wait: async () => {}, maxChecks: 2 }), /no matching browser offer/);
  await assert.rejects(answerPickedOffer({ desktop, taskId: 'picked', isConnected: () => false }), /Widget closed/);
  assert.equal(answers, 1);
});

test('active call is transferred, wrapped and cleared before emergency claim and one answer', async () => {
  const calls = [];
  let map = new Map([['active', structuredClone(activeTask)]]);
  const desktop = { actions: { getTaskMap: async () => map, acceptWebRtcCall: async () => calls.push('answer') },
    agentContact: {
      async vteamTransferV2(payload) {
        calls.push('transfer');
        assert.equal(payload.data.to, 'original-queue');
        map.get('active').interaction.state = 'wrapup';
        return { type: 'AgentVteamTransferred' };
      },
      async wrapupV2(payload) {
        calls.push('wrapup');
        assert.equal(payload.interactionId, 'active');
        map = new Map();
        return { type: 'AgentWrappedUp' };
      }
    } };
  await takeEmergency({ desktop, settings, picked, getRows: async () => [picked],
    claim: async id => {
      calls.push('claim');
      assert.equal(id, 'picked');
      map = new Map([['picked', { interaction: { mediaType: 'telephony', state: 'offered' } }]]);
      return { status: 202 };
    } });
  assert.deepEqual(calls, ['transfer', 'wrapup', 'claim', 'answer']);
});

test('stale emergency, missing wrapup settings and transfer failure never claim or answer', async () => {
  for (const scenario of ['stale', 'config', 'transfer']) {
    let transfers = 0;
    const desktop = { actions: { getTaskMap: async () => new Map([['active', activeTask]]), acceptWebRtcCall: async () => assert.fail() },
      agentContact: { wrapupV2() {}, async vteamTransferV2() { transfers++; return { type: 'AgentVteamTransferFailed' }; } } };
    await assert.rejects(takeEmergency({ desktop, settings: scenario === 'config' ? { ...settings, wrapUpCodeId: '' } : settings,
      picked, getRows: async () => scenario === 'stale' ? [] : [picked], claim: async () => assert.fail() }));
    assert.equal(transfers, scenario === 'transfer' ? 1 : 0);
  }
});

test('idle agent claims and answers without transfer or wrap-up', async () => {
  let map = new Map();
  const calls = [];
  const desktop = { actions: { getTaskMap: async () => map, acceptWebRtcCall: async () => calls.push('answer') } };
  await takeEmergency({ desktop, settings, picked, getRows: async () => [picked], claim: async () => {
    calls.push('claim');
    map = new Map([['picked', { interaction: { mediaType: 'telephony', state: 'offered' } }]]);
  } });
  assert.deepEqual(calls, ['claim', 'answer']);
});


test('full oldest-first pages without accessible links advance to the newest contact', async () => {
  const source = Array.from({ length: 1505 }, (_, index) => row('task-' + index, index + 2,
    index === 1504 ? {} : { status: 'completed', queue: { id: 'other', name: 'Other' } }));
  let requests = 0;
  const pages = [];
  const result = await listEmergencyTasks({ apiBase: 'https://api.test', token: 'secret-token', from: 0, to: 2000,
    onPage: page => pages.push(page), fetcher: async raw => {
      const url = new URL(raw);
      assert.equal(url.searchParams.get('pageSize'), '1000');
      assert.equal(url.searchParams.get('channelTypes'), 'telephony');
      assert.equal(url.searchParams.get('to'), '2000');
      requests++;
      const start = Number(url.searchParams.get('from'));
      return { ok: true, json: async () => ({ data: source.filter(row => row.attributes.createdTime > start).slice(0, 1000) }) };
    } });
  assert.equal(requests, 2);
  assert.equal(result.length, 1505);
  assert.equal(newestEmergency(result, settings).id, 'task-1504');
  assert.deepEqual(pages.map(page => page.count), [1000, 506]);
});

test('overlapping full-page timestamps are preserved; unpageable ties fail explicitly', async () => {
  const source = Array.from({ length: 1100 }, (_, index) => row('task-' + index, index < 950 ? 2 : 3));
  const result = await listEmergencyTasks({ apiBase: 'https://api.test', token: 'test', from: 0, to: 10,
    fetcher: async raw => ({ ok: true, json: async () => ({ data: source.filter(row => row.attributes.createdTime > Number(new URL(raw).searchParams.get('from'))).slice(0, 1000) }) }) });
  assert.equal(result.length, 1100);
  await assert.rejects(listEmergencyTasks({ apiBase: 'https://api.test', token: 'test', from: 0, to: 10,
    fetcher: async () => ({ ok: true, json: async () => ({ data: Array.from({ length: 1000 }, (_, index) => row('task-' + index, 2)) }) }) }), /results are incomplete/);
});

test('diagnostics expose aggregate queue status and counts without callers or tokens', () => {
  const report = emergencyDiagnostics([row('private-task-id', 1, { origin: 'private-phone' }), row('completed', 2, { status: 'completed' })],
    { queueName: 'Emergency Queue', wxccApiBaseUrl: 'https://api.test' }, [{ count: 2, status: 200 }]);
  assert.equal(report.targetQueueTaskCount, 2);
  assert.equal(report.waitingTaskCount, 1);
  assert.deepEqual(report.targetStatuses, ['queued', 'completed']);
  assert.equal(report.build, 'emergency-header-3');
  assert.doesNotMatch(JSON.stringify(report), /private-phone|private-task-id|Authorization|Bearer/);
});

test('queue must be configured explicitly by name or ID; missing config cannot match calls', () => {
  assert.throws(() => configuredEmergencyQueue({}), /Set emergencyQueueName or emergencyQueueId/);
  assert.throws(() => configuredEmergencyQueue({ emergencyQueueName: '   ', emergencyQueueId: '' }), /Set emergencyQueueName/);
  assert.deepEqual(configuredEmergencyQueue({ emergencyQueueName: '  Priority Voice  ' }), { queueName: 'Priority Voice', queueId: '' });
  assert.deepEqual(configuredEmergencyQueue({ emergencyQueueId: ' queue-123 ' }), { queueName: '', queueId: 'queue-123' });
  assert.equal(newestEmergency([picked]), null);
  assert.equal(newestEmergency([row('other-config', 100, { queue: { name: 'Other Queue' } })], { queueName: 'Other Queue' }).id, 'other-config');
});

test('layout queue properties override shared configuration without retaining its old ID', () => {
  const config = { emergencyQueueName: 'Shared Queue', emergencyQueueId: 'shared-id' };
  assert.deepEqual(configuredEmergencyQueue(config, { emergencyQueueName: '  Header Queue  ' }), { queueName: 'Header Queue', queueId: '' });
  assert.deepEqual(configuredEmergencyQueue(config, { emergencyQueueId: 'header-id' }), { queueName: '', queueId: 'header-id' });
  assert.deepEqual(configuredEmergencyQueue(config, { emergencyQueueName: '', emergencyQueueId: '' }), { queueName: 'Shared Queue', queueId: 'shared-id' });
  assert.equal(newestEmergency([row('wrong-id', 100, { queue: { id: 'other', name: 'Shared Queue' } })], configuredEmergencyQueue(config)), null);
});
