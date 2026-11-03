import { voiceTasks, loadAvailableTransferQueues, withDeadline, transferThenClaim, configuredTransferWrapup } from '../queue-transfer.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { acceptClaimedWebRtcCall } from '../webrtc.js';
import { postJson, mergeCallerIds, assignVoiceTask } from '../transport.js';

test('Web Component starts without Calling or Socket.io and cleans up its polling/listeners', async () => {
  const nodes = new Map();
  const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    replaceChildren() {}, content: { cloneNode() { return {}; } }, appendChild() {}, addEventListener() {}, removeEventListener() {} });
  const shadow = { appendChild() {}, getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); }, querySelectorAll() { return []; } };
  const intervals = new Set();
  const listeners = new Set();
  const service = { addEventListener(name, handler) { listeners.add(handler); }, removeEventListener(name, handler) { listeners.delete(handler); } };
  const Desktop = { logger: { createLogger() { return {}; } }, config: { init() {} }, actions: { async getMediaTypeQueue() { return []; }, async getToken() { return 'test'; }, async getTaskMap() { return new Map(); } },
    agentStateInfo: { ...service, latestData: {} }, agentContact: { ...service, SERVICE: {
      webex: { token: { access_token: 'test' }, async fetchPersonData() { return {}; } }
    } } };
  let componentClass;
  const context = { voiceTasks, loadAvailableTransferQueues, withDeadline, transferThenClaim, configuredTransferWrapup, acceptClaimedWebRtcCall, Desktop, postJson, mergeCallerIds, assignVoiceTask, URL, Promise, Map, Date, console, structuredClone,
    location: { href: 'https://desktop.wxcc-us1.cisco.com/' },
    Cookies: { get() {}, set() {} },
    HTMLElement: class { constructor() { this.isConnected = true; } attachShadow() { this.shadowRoot = shadow; } },
    customElements: { get() { return null; }, define(name, cls) { assert.equal(name, 'sa-ds-voice-sdk'); componentClass = cls; } },
    setInterval(fn) { intervals.add(fn); return fn; }, clearInterval(fn) { intervals.delete(fn); },
    setTimeout() { return 1; }, clearTimeout() {},
    async fetch(url) { assert.match(url, /^https:\/\/api.wxcc-us1.cisco.com\/v1\/tasks/); return { ok: true, json: async () => ({ data: [] }) }; },
    document: { currentScript: { src: 'https://hosting.test/cherry-picker/build/bundle.js' },
      createElement: element,
      head: { appendChild(script) {
        if (script.src && new URL(script.src).pathname.endsWith('/config.js')) {
          assert.ok(new URL(script.src).searchParams.has('_refresh'), 'runtime configuration bypasses stale browser cache');
          context.CHERRY_PICKER_CONFIG = { apiBaseUrl: './api/', wxccApiBaseUrl: 'https://api.wxcc-us1.cisco.com', pollIntervalMs: 5000, conferenceEnabled: false };
        }
        if (script.onload) queueMicrotask(() => script.onload());
      } }
    }
  };
  context.window = context;
  vm.createContext(context);
  const source = (await readFile(new URL('../widget-SDK-Voice.js', import.meta.url), 'utf8')).replace(/^import .*;$/gm, '');
  vm.runInContext(source, context);
  const component = new componentClass();
  assert.equal(typeof nodes.get('refresh-transfer-queues').onclick, 'function', 'refresh is wired before SDK initialization');
  await component.connectedCallback();
  assert.equal(intervals.size, 2, 'task polling and call-state polling started');
  assert.equal(listeners.size, 9);
  assert.equal(nodes.get('queue-content').style.display, 'block');
  assert.equal(context.settings, undefined); // settings remain scoped inside the bundle
  component.assignTask = async () => { throw new Error('Claim failed (HTTP 403): manual assignment disabled'); };
  await component.claimButtonClick(component, { id: 'call-1-button' });
  assert.match(nodes.get('claim-status').textContent, /manual assignment disabled/);
  assert.equal(nodes.get('call-1-button').disabled, false);
  component.assignTask = async () => ({ status: 202 });
  await component.claimButtonClick(component, { id: 'call-1-button' });
  assert.match(nodes.get('claim-status').textContent, /accepted.*202/);
  assert.equal(component.claimInFlight, false);
  assert.equal(nodes.get('webrtc-accept').hidden, false);
  assert.equal(component.webRtcTaskId, 'call-1');
  await component.acceptBrowserCall();
  assert.match(nodes.get('webrtc-status').textContent, /does not expose WebRTC Accept/);
  await component.transferAndPick('picked-2');
  assert.match(nodes.get('claim-status').textContent, /Select a destination queue/);
  component.transferQueues = [{ id: 'queue-2', name: 'Support' }];
  nodes.get('transfer-queue').value = 'queue-2';
  let reads = 0;
  Desktop.actions.getTaskMap = async () => ++reads <= 2 ? new Map([['active', { interaction: { mediaType: 'telephony', state: 'connected' } }]]) : new Map();
  let transferPayload;
  Desktop.agentContact.vteamTransferV2 = async payload => { transferPayload = payload; return { type: 'AgentVteamTransferred' }; };
  component.checkPickedCall = async () => {};
  let claimed;
  component.assignTask = async id => { claimed = id; return { status: 202 }; };
  await component.transferAndPick('picked-2');
  assert.equal(transferPayload.interactionId, 'active');
  assert.equal(transferPayload.data.to, 'queue-2');
  assert.equal(transferPayload.data.destinationType, 'queue');
  assert.equal(claimed, 'picked-2');
  assert.equal(component.webRtcTaskId, 'picked-2');
  assert.equal(nodes.get('webrtc-accept').hidden, false);
  assert.equal(nodes.get('transfer-queue').disabled, false);
  assert.match(nodes.get('claim-status').textContent, /transferred to Support/);
  // Exercise the actual Refresh button and ensure it recovers after a failed request.
  let finishLookup;
  Desktop.actions.getMediaTypeQueue = () => new Promise(resolve => { finishLookup = resolve; });
  const refreshing = nodes.get('refresh-transfer-queues').onclick();
  assert.equal(nodes.get('refresh-transfer-queues').disabled, true);
  assert.match(nodes.get('transfer-queue-status').textContent, /Loading/);
  while (!finishLookup) await Promise.resolve();
  finishLookup([{ id: 'queue-2', name: 'Support', channelType: 'telephony' }]);
  await refreshing;
  assert.match(nodes.get('transfer-queue-status').textContent, /Loaded 1 voice transfer queue/);
  assert.equal(nodes.get('refresh-transfer-queues').disabled, false);
  Desktop.actions.getMediaTypeQueue = async () => { throw new Error('SDK queue lookup failed'); };
  await nodes.get('refresh-transfer-queues').onclick();
  assert.match(nodes.get('transfer-queue-status').textContent, /SDK queue lookup failed/);
  assert.equal(nodes.get('refresh-transfer-queues').disabled, false);
  assert.equal(component.loadingTransferQueues, false);
  const originalLoad = component.loadTransferQueues;
  let sessionRefreshes = 0;
  component.loadTransferQueues = async () => { sessionRefreshes++; };
  component.captureQueueSession({ agentSessionId: 'granular-session' });
  assert.equal(component.queueAgentSessionId, 'granular-session');
  assert.equal(sessionRefreshes, 1);
  component.captureQueueSession({ data: { agentSessionId: 'granular-session' } });
  assert.equal(sessionRefreshes, 1, 'same session does not trigger repeated lookups');
  component.captureQueueSession({ data: { agentSessionId: 'new-session' } });
  assert.equal(component.queueAgentSessionId, 'new-session');
  assert.equal(sessionRefreshes, 2);
  component.loadTransferQueues = originalLoad;
  // A second instance must receive a handler even while the shared loaded flag is true.
  const second = new componentClass();
  let secondRefresh = false;
  second.loadTransferQueues = async () => { secondRefresh = true; };
  await nodes.get('refresh-transfer-queues').onclick();
  assert.equal(secondRefresh, true);
  component.isConnected = false;
  component.disconnectedCallback();
  assert.equal(intervals.size, 0);
  assert.equal(listeners.size, 0);
});
