import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

test('installed SDK dispatches the WebRTC answer event', () => {
  const events = [];
  const storage = { getItem() { return null; }, setItem() {}, removeItem() {} };
  const context = { console: { ...console, info() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, AGENTX_SERVICE: {},
    CustomEvent: class { constructor(type) { this.type = type; } }, exports: {}, module: { exports: {} } };
  context.window = { sessionStorage: storage, localStorage: storage,
    dispatchEvent(event) { events.push(event.type); }, addEventListener() {}, removeEventListener() {} };
  context.self = context.window;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../node_modules/@wxcc-desktop/sdk/dist/index.js', import.meta.url), 'utf8'), context);
  context.module.exports.Desktop.actions.acceptWebRtcCall();
  assert.deepEqual(events, ['ax-web-call-answer']);
});
