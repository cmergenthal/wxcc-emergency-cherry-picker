import { Desktop } from '@wxcc-desktop/sdk';
import { withDeadline } from './queue-transfer.js';
import { assignVoiceTask } from './transport.js';
import { acceptClaimedWebRtcCall } from './webrtc.js';
import { newestEmergency, listEmergencyTasks, takeEmergency, emergencyDiagnostics, configuredEmergencyQueue } from './emergency-header.js';

const sourceUrl = document.currentScript?.src;
const configUrl = new URL('../config.js', sourceUrl || location.href);
const configReady = new Promise((resolve, reject) => {
  const script = document.createElement('script');
  configUrl.searchParams.set('_refresh', String(Date.now()));
  script.src = configUrl.href;
  script.onload = () => window.CHERRY_PICKER_CONFIG ? resolve({ ...window.CHERRY_PICKER_CONFIG }) : reject(new Error('Emergency widget configuration is missing.'));
  script.onerror = () => reject(new Error('Cannot load emergency widget configuration.'));
  document.head.appendChild(script);
});
configReady.catch(() => {});

class EmergencyHeader extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:inline-flex;align-items:center;max-width:100%;font:13px system-ui,sans-serif;color:inherit}
        .bar{display:flex;align-items:center;gap:10px;max-width:520px;min-height:40px;padding:3px 8px;border:1px solid #b8bec6;border-radius:8px;box-sizing:border-box}
        .dot{width:7px;height:7px;flex:none;border-radius:50%;background:#9299a2}.ready .dot{background:#c82c35}
        .copy{display:grid;min-width:90px;max-width:260px;gap:1px}.title{font-size:11px;opacity:.72}
        .contact,.status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{font-size:10px;max-width:300px;opacity:.85}.status.error{color:#c62828}
        button{font:inherit;font-weight:600;border:0;border-radius:5px;background:#b51f2b;color:#fff;min-height:30px;padding:5px 12px;cursor:pointer;white-space:nowrap}
        button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #3984d5;outline-offset:2px}
        .info{background:transparent;color:inherit;border:1px solid #aeb6c1;border-radius:50%;width:24px;min-height:24px;padding:0;font-size:12px}
        dialog{border:1px solid #aeb6c1;border-radius:10px;max-width:min(720px,90vw);max-height:80vh;color:#17202c;background:#fff;padding:18px}
        dialog::backdrop{background:#0005}pre{font:12px ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}dialog button{margin-right:8px}
        @media(prefers-color-scheme:dark){.bar{border-color:#626a75}.status.error{color:#ffb1b1}}
      </style>
      <div class="bar">
        <span class="dot" aria-hidden="true"></span>
        <div class="copy"><span class="title">Emergency</span><span class="contact">Loading…</span><span class="status" role="status" aria-live="polite"></span></div>
        <button type="button" disabled>Answer</button>
        <button type="button" class="info" aria-label="Queue diagnostics" title="Queue diagnostics">i</button>
      </div>
      <dialog aria-label="Emergency queue diagnostics"><strong>Emergency queue diagnostics</strong><p>Queue names, statuses and request counts. No caller numbers or tokens.</p><pre></pre><button type="button" class="close-report">Close</button><button type="button" class="copy-report">Copy report</button></dialog>`;
    this.nodes = Object.fromEntries(['bar', 'title', 'contact', 'status'].map(name => [name, this.shadowRoot.querySelector(`.${name}`)]));
    this.button = this.shadowRoot.querySelector('button');
    this.button.onclick = () => this.answer();
    this.shadowRoot.querySelector('.info').onclick = () => {
      this.shadowRoot.querySelector('pre').textContent = JSON.stringify(this.diagnostics || { build: 'emergency-header-3', state: 'No completed lookup yet.' }, null, 2);
      this.shadowRoot.querySelector('dialog').showModal();
    };
    this.shadowRoot.querySelector('.close-report').onclick = () => this.shadowRoot.querySelector('dialog').close();
    this.shadowRoot.querySelector('.copy-report').onclick = async () => {
      try { await navigator.clipboard.writeText(this.shadowRoot.querySelector('pre').textContent); }
      catch { this.shadowRoot.querySelector('.copy-report').textContent = 'Select and copy the report above'; }
    };
    this.offers = new Set();
    this.wrapups = new Set();
    this.listeners = [];
  }

  async connectedCallback() {
    if (this.starting || this.started) return;
    this.starting = true;
    const generation = this.generation = (this.generation || 0) + 1;
    try {
      const config = await configReady;
      if (!this.isConnected || this.generation !== generation) return;
      this.settings = { ...config, ...configuredEmergencyQueue(config, this),
        emergencyTransferMode: config.emergencyTransferMode || 'original' };
      this.nodes.title.textContent = this.settings.queueName ? `Emergency · ${this.settings.queueName}` : 'Emergency';
      await withDeadline(() => Desktop.config.init({ widgetName: 'Emergency Header', widgetProvider: 'Custom' }), 15000, 'Desktop initialization timed out. Reload Desktop.');
      if (!this.isConnected || this.generation !== generation) return;
      this.listen('eAgentOfferContact', event => {
        const id = event.data?.interactionId || event.interactionId;
        if (this.busy && id === this.targetId) this.offers.add(id);
      });
      this.listen('eAgentWrapup', event => {
        const id = event.data?.interactionId || event.interactionId;
        if (this.busy && id) this.wrapups.add(id);
      });
      this.listen('eAgentContactAssigned', event => {
        const id = event.data?.interactionId || event.interactionId;
        if (id && (id === this.targetId || id === this.pending?.id)) {
          this.pendingAnswered = true;
          this.render();
        }
      });
      this.listen('eAgentContactEnded', event => this.clearPending(event));
      this.listen('eAgentContactWrappedUp', event => this.clearPending(event));
      this.started = true;
      await this.poll();
      if (!this.isConnected || this.generation !== generation) return;
      this.timer = setInterval(() => this.poll(), Math.max(5000, Number(config.pollIntervalMs) || 5000));
    } catch (error) {
      if (this.isConnected) {
        this.lookupFailed = true;
        this.status(error.message, true);
        this.render();
      }
    }
    finally { this.starting = false; }
  }

  listen(event, handler) {
    Desktop.agentContact.addEventListener(event, handler);
    this.listeners.push({ event, handler });
  }

  clearPending(event) {
    const id = event.data?.interactionId || event.interactionId;
    if (id === this.pending?.id && !this.busy) {
      this.pending = null;
      this.pendingAnswered = false;
      this.status('');
      this.poll();
    }
  }

  async token() {
    const token = await withDeadline(() => Desktop.actions.getToken(), 10000, 'Agent token lookup timed out.');
    if (typeof (token || this.accessToken) !== 'string' || !(token || this.accessToken)) throw new Error('Agent access token is unavailable.');
    return token || this.accessToken;
  }

  async rows(from) {
    const token = await this.token();
    const abort = new AbortController();
    this.requests ||= new Set();
    this.requests.add(abort);
    const timer = setTimeout(() => abort.abort(), 15000);
    const pages = [];
    let rows = [];
    try {
      const lookback = Math.max(600000, Number(this.settings.emergencyLookbackMs) || 86400000);
      const now = Date.now();
      const request = (start, end) => listEmergencyTasks({ apiBase: this.settings.wxccApiBaseUrl, token,
        from: start, to: end, signal: abort.signal, onPage: page => pages.push(page) });
      if (from !== undefined) return await request(from, now);
      // Search recent arrivals first. A completed recent range with a match is
      // sufficient to select the newest contact; older contacts cannot outrank it.
      const recentFrom = now - 600000;
      rows = await request(recentFrom, now);
      if (!newestEmergency(rows, this.settings) && lookback > 600000) {
        const older = await request(now - lookback, recentFrom + 1);
        rows = [...new Map([...older, ...rows].map(row => [row.id, row])).values()];
      }
      this.diagnostics = { ...emergencyDiagnostics(rows, this.settings, pages), complete: true };
      return rows;
    } catch (error) {
      const message = error.name === 'AbortError' ? 'Emergency queue lookup timed out or the widget closed; results are incomplete.' : error.message;
      if (from === undefined) this.diagnostics = { ...emergencyDiagnostics(rows, this.settings, pages), complete: false, error: message };
      throw new Error(message);
    } finally { clearTimeout(timer); this.requests.delete(abort); }
  }

  async poll() {
    if (this.polling || this.busy || !this.isConnected) return;
    this.polling = true;
    try {
      const rows = await this.rows();
      if (!this.isConnected || this.busy) return;
      this.latest = newestEmergency(rows, this.settings);
      this.lookupFailed = false;
      if (!this.pending && !this.operationError) this.status(this.latest ? '' : `API: ${rows.length} voice tasks · ${this.diagnostics?.targetQueueTaskCount || 0} in target queue`);
    } catch (error) {
      this.lookupFailed = true;
      this.latest = null;
      if (this.isConnected) this.status(error.message, true);
    } finally { this.polling = false; if (this.isConnected) this.render(); }
  }

  status(message, error = false) {
    this.nodes.status.textContent = message;
    this.nodes.status.title = message;
    this.nodes.status.classList.toggle('error', error);
    this.button.title = message;
  }

  render() {
    const row = this.pending || this.latest;
    const task = row?.attributes;
    const origin = task?.origin;
    this.nodes.contact.textContent = row ? (typeof origin === 'object' ? origin.name || origin.id || 'Unknown caller' : origin || 'Unknown caller') : (this.lookupFailed ? 'Queue unavailable' : 'No waiting emergency calls');
    this.nodes.contact.title = row ? `Newest waiting contact · ${new Date(Number(task.createdTime)).toLocaleTimeString()}` : '';
    this.nodes.bar.classList.toggle('ready', !!row);
    this.button.disabled = this.busy || !!(this.pending && this.pendingAnswered) || !row || (!this.pending && this.lookupFailed);
    this.button.textContent = this.busy ? 'Connecting…' : this.pending && this.pendingAnswered ? 'On call' : this.pending ? 'Accept' : 'Answer';
  }

  async answer() {
    if (this.busy) return;
    const picked = this.pending || this.latest;
    if (!picked || (!this.pending && this.lookupFailed)) return;
    this.operationError = false;
    const retryAnswer = !!this.pending;
    if (!retryAnswer) this.pendingAnswered = false;
    this.busy = true;
    this.targetId = picked.id;
    this.offers.clear();
    this.wrapups.clear();
    this.render();
    let claimed = retryAnswer;
    const isConnected = () => this.isConnected;
    try {
      if (retryAnswer) {
        await withDeadline(() => acceptClaimedWebRtcCall(Desktop.actions, picked.id), 5000, 'Browser answer request timed out.');
        this.status('Answer requested. Confirm audio in Agent Desktop.');
      } else {
        this.status('Checking emergency call…');
        if (this.settings.webRtcEnabled === false || typeof Desktop.actions.acceptWebRtcCall !== 'function') throw new Error('One-click answer requires Desktop browser audio and WebRTC support.');
        await takeEmergency({ desktop: Desktop, settings: this.settings, picked,
          getRows: () => this.rows(Number(picked.attributes.createdTime) - 1),
          claim: async id => {
            if (!this.isConnected) throw new Error('Widget closed before claiming.');
            const result = await assignVoiceTask(this.settings.wxccApiBaseUrl, id, await this.token());
            claimed = true;
            this.pending = picked;
            return result;
          },
          hasOffer: id => this.offers.has(id), isWrappingUp: id => this.wrapups.has(id),
          onStatus: message => { if (this.isConnected) this.status(message); }, isConnected });
      }
      this.pending = picked; // Allows a user gesture fallback; never submits Claim twice.
    } catch (error) {
      this.operationError = true;
      if (this.isConnected) this.status(error.message, true);
      if (!claimed) this.pending = null;
    } finally {
      this.busy = false;
      this.targetId = null;
      if (this.isConnected) this.render();
    }
  }

  disconnectedCallback() {
    this.generation = (this.generation || 0) + 1;
    clearInterval(this.timer);
    for (const request of this.requests || []) request.abort();
    for (const { event, handler } of this.listeners) Desktop.agentContact.removeEventListener(event, handler);
    this.listeners = [];
    this.started = false;
  }
}

if (!customElements.get('cmergent-emergency-header')) customElements.define('cmergent-emergency-header', EmergencyHeader);
