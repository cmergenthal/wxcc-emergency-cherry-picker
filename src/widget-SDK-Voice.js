import { voiceTasks, loadAvailableTransferQueues, withDeadline, transferThenClaim, configuredTransferWrapup } from './queue-transfer.js';
import { acceptClaimedWebRtcCall } from './webrtc.js';
import { Desktop } from "@wxcc-desktop/sdk";
import { postJson, mergeCallerIds, assignVoiceTask } from './transport.js';

const scriptUrl = document.currentScript?.src;
const assetBase = scriptUrl ? new URL('../', scriptUrl).href : new URL('./', location.href).href;
const configUrl = new URL('config.js', assetBase).href;
let settings;
const configReady = new Promise((resolve, reject) => {
  const script = document.createElement('script');
  // Hosting may cache JavaScript for weeks. Runtime settings must refresh even
  // when config.js changes independently of the bundle's version.
  const freshConfigUrl = new URL(configUrl);
  freshConfigUrl.searchParams.set('_refresh', String(Date.now()));
  script.src = freshConfigUrl.href;
  script.onload = () => {
    const config = window.CHERRY_PICKER_CONFIG;
    if (!config) return reject(new Error('Missing Cherry Picker configuration'));
    settings = { ...config, apiBaseUrl: new URL(config.apiBaseUrl || './api/', configUrl).href,
      pollIntervalMs: Math.max(5000, Number(config.pollIntervalMs) || 5000) };
    resolve(settings);
  };
  script.onerror = () => reject(new Error('Cannot load Cherry Picker config.js'));
  document.head.appendChild(script);
});
// Initialization reports this error in the component, without an unhandled rejection.
configReady.catch(() => {});
async function agentToken() {
  const token = await Desktop.actions.getToken() || currentWidgetInstance?.accessToken;
  if (!token) throw new Error('Agent Desktop access token is unavailable');
  return token;
}
async function backendPost(endpoint, body) {
  await configReady;
  return postJson(new URL(endpoint, settings.apiBaseUrl).href, body, await agentToken());
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
//import Calling from '@webex/calling';

const template = document.createElement("template");
var loaded = false;

function customLog(msg, args, logNameSuffix){
  if (!settings?.debug) return;
  let logName = "cc-widget-logger:"
  if(logNameSuffix){
    logName += logNameSuffix + ":";
  } else {
    logName += "default:";
  }
  if(args){
    console.log(logName+ msg, args);  
  } else {
    console.log(logName, msg);
  }
}

template.innerHTML = `
  <style>

  .loading-icon {
    width: 30px;
    left: 50%;
    position: relative;
    transform: translateX(-50%);
  }

  .button-loading-icon {
    position: relative;
    width: 20px;
    left: 45px;
    top: 3px;
    /*transform: translate(-45px, 5px);*/
  }

  .invisible {
    visibility: hidden;
  }

  .hidden {
    display:none;
  }

  .result-span {
    text-align:center;
    display:block;
    min-height: 24px;
  }

  .fieldset {
    width: 550px;
    border-radius: 5px;
    max-height:675px;
    overflow:scroll;
  }

  .button{
    display: block;
    border-radius: 5px;
    background: #064157;
    color: white;
    padding: 4px;
    margin-top: 10px;
    width: 100%;
    border: none;
    transition:.3s;
  }

  button:disabled,
  button[disabled]{
    border: 1px solid #999999;
    background-color: #cccccc;
    color: #666666;
  }
  
  input{
    border-top: none;
    border-right: none;
    border-left: none;
    border-color: #DDDDDD;
    border-width: 1.5px;
    color: #005E7D
  }

  *:focus {
    outline: none;
  }

  button:hover:enabled{
    cursor: pointer;
  }

  table {
    margin-top:10px;
  }

  h4 {
    margin:0px;
  }

  p {
    margin:0px;
  }

  .faded {
    color: #888;
  }

  .column-one {
    padding-right: 30px;
  }

  .origin-cell {
    height:30px; /*this keeps our sizing when the claim buttons disappear*/
  }

  .card {
    /* Add shadows to create the "card" effect */
    box-shadow: 0 4px 8px 0 rgba(0,0,0,0.2);
    transform: translateX(-100%); /* Start off-screen to the left */
    opacity: 0;
    transition: transform 0.5s ease-out, opacity 0.5s ease-out;
    /* transition: 0.3s; */
    border-radius: 5px; /* 5px rounded corners */
  }

  .card.animate {
    transform: translateX(0); /* Slide in to its final position */
    opacity: 1;
  }

  /* On mouse-over, add a deeper shadow */
  /* .card:hover {
    box-shadow: 0 8px 16px 0 rgba(0,0,0,0.2);
  } */

  /* Add some padding inside the card container */
  .container {
    padding: 2px 16px;
  }
 
  .flat-rounded-button {
    background-color: #6aeb6a; /* Flat background color */
    color: white; /* Text color */
    border: none; /* Remove default border for a flat look */
    padding: 5px 15px; /* Adjust padding as needed */
    border-radius: 8px; /* Rounded corners */
    font-size: 16px;
    cursor: pointer; /* Indicate interactivity */
    transition: background-color 0.3s ease; /* Smooth transition on hover */
    margin-left: 10px;
  }

  .flat-rounded-button:hover:enabled {
    background-color: #59c959; /* Darker background on hover */
  }

  .flat-rounded-button:active:enabled {
    background-color: #459945; /* Even darker background on click */
  }

  .flat-rounded-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .flat-rounded-conference-button {
    background-color: #0d6efd; /* Blue-ish color */
    color: white;
    border: none;
    padding: 5px 15px;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: background-color 0.3s ease, opacity 0.3s ease;
    margin-left: 10px;
  }

  .flat-rounded-conference-button:hover:enabled {
    background-color: #0b5ed7; /* Darker blue on hover */
  }

  .flat-rounded-conference-button:active:enabled {
    background-color: #0a58ca; /* Even darker blue on click */
  }

  .flat-rounded-conference-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .checkbox-container {
    display: inline-block;
    margin-right: 15px; /* Adjust spacing as needed */
  }

  #mainContainer {
    display: flex;
    gap: 20px;
  }

  #merge-panel {
    min-width: 250px;
    max-width: 300px;
    padding: 20px;
    border-radius: 5px;
    box-shadow: 0 4px 8px 0 rgba(0,0,0,0.2);
    background-color: white;
    align-self: flex-start;
  }

  #merge-panel h3 {
    margin-top: 0;
    color: #064157;
    font-size: 18px;
  }

  #merge-panel .merge-info {
    margin: 15px 0;
    padding: 10px;
    background-color: #f0f8ff;
    border-radius: 5px;
    border-left: 3px solid #064157;
  }

  #merge-panel .merge-info label {
    font-weight: bold;
    color: #064157;
    font-size: 12px;
    display: block;
    margin-bottom: 5px;
  }

  #merge-panel .merge-info .number {
    font-size: 16px;
    color: #005E7D;
    font-weight: 600;
  }

  #merge-button {
    width: 100%;
    background-color: #6aeb6a;
    color: white;
    border: none;
    padding: 10px 15px;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
    transition: background-color 0.3s ease;
    margin-top: 10px;
  }

  #merge-button:hover:enabled {
    background-color: #59c959;
  }

  #merge-button:active:enabled {
    background-color: #459945;
  }

  #merge-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    background-color: #cccccc;
  }

  </style>

    <div id="mainContainer">
      <div>
        <div id="main-fieldset" class="fieldset">
          <div>
            <img id="loading-icon" src="${assetBase.replace(/\/$/, "")}/img/loading-1.gif" class="loading-icon"/>
            <div id="queue-content" style="display:none;">
              <div class="checkbox-container">
                <input class="checkbox-input" type="checkbox" id="queued" name="queued" value="queued" checked>
                <label for="queued">Queued</label>
              </div>
              <div class="checkbox-container">
                <input class="checkbox-input" type="checkbox" id="assigned" name="assigned" value="assigned" checked>
                <label for="assigned">Assigned</label>
              </div>
              <div class="checkbox-container">
                <input class="checkbox-input" type="checkbox" id="abandoned" name="abandoned" value="abandoned" checked>
                <label for="abandoned">Abandoned</label>
              </div>
              <div class="checkbox-container">
                <input class="checkbox-input" type="checkbox" id="completed" name="completed" value="completed" checked>
                <label for="completed">Completed</label>
              </div>
              <p id="claim-status" role="status" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere;"></p>
              <button id="webrtc-accept" class="flat-rounded-button" hidden>Accept browser call</button>
              <p id="webrtc-status" role="status" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere;"></p>
              <div id="queue-transfer-panel" hidden style="margin:12px 0;padding:12px;border:1px solid #bbb;border-radius:8px;">
                <label for="transfer-queue">Send active call to:</label>
                <select id="transfer-queue" style="max-width:100%;padding:8px;margin:6px;"><option value="">Select a queue</option></select>
                <button id="refresh-transfer-queues" type="button">Refresh queues</button>
                <p id="transfer-queue-status" role="status" aria-live="polite"></p>
                <small>Select a destination, then click “Transfer &amp; pick” beside the call you want next.</small>
              </div>
              <div id="my-queue"></div>
            </div>
            <span id="result-span" class="result-span"></span>
          </div>
        </div>
      </div>
      <div id="merge-panel" class="invisible">
        <h3>Merge Calls</h3>
        <div class="merge-info">
          <label>Caller Number:</label>
          <div class="number" id="merge-caller-number">-</div>
        </div>
        <button id="merge-button">Merge</button>
      </div>
    </div>
`;

//Creating a custom logger
const logger = Desktop.logger.createLogger("cc-widget-logger");

var initResult = false;
var queueTasks = {};
var callerIds = {};
var queueStatuses = ["queued", "assigned", "abandoned", "completed"];
var agentIsOnCall = false;

var currentCall;
var previousCall;
var previousCallNumber;
var trackedTransferPayload;
var showMergePanel = false;
var currentWidgetInstance = null;

function addOrReplaceEventListener(element, eventName, newListener) {
  // Check if an event listener with the same name already exists
  const hasExistingListener = element.hasOwnProperty(`_${eventName}Listener`);
  if (hasExistingListener) {
    element.removeEventListener(eventName, element[`_${eventName}Listener`]);
  }
  element.addEventListener(eventName, newListener);
  // Store the new listener for future replacement
  element[`_${eventName}Listener`] = newListener;
}

function capitalizeFirstLetter(string) {
  if (typeof string !== 'string' || string.length === 0) {
    return string; // Handle empty strings or non-string inputs
  }
  return string.charAt(0).toUpperCase() + string.slice(1);
}

function makeStringTime(epochTime){
  const millisecondDiff = Date.now() - epochTime;
  const seconds = Math.floor(millisecondDiff / 1000);
  const minutes = Math.round(seconds/60);
  return `${minutes}m`;
}


async function getCallerIds(taskIds){
  customLog("getCallerIds:");
  customLog(taskIds);
  const result = [];
  for (let start = 0; start < taskIds.length; start += 200) {
    result.push(...await backendPost('caller-ids.php', { taskIds: taskIds.slice(start, start + 200) }));
  }
  return result;
}


class myDesktopSDK extends HTMLElement {
  constructor() {
    super();

    const font = document.createElement("link");
    font.href = "https://fonts.googleapis.com/css2?family=Cutive+Mono&family=Darker+Grotesque:wght@300&family=Poppins:wght@200;400&display=swap";
    font.rel = "stylesheet";
    document.head.appendChild(font);

    const cookieSDK = document.createElement("script");
    cookieSDK.src = "https://cdn.jsdelivr.net/npm/js-cookie@2/src/js.cookie.min.js";
    this.cookiesReady = new Promise((resolve, reject) => {
      cookieSDK.onload = resolve;
      cookieSDK.onerror = () => reject(new Error('Unable to load cookie helper'));
    });
    this.cookiesReady.catch(() => {});
    document.head.appendChild(cookieSDK);

    this.desktopListeners = [];
    this.attachShadow({ mode: "open" });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    // Every instance needs its own handler, even when Desktop is already initialized.
    this.shadowRoot.getElementById('refresh-transfer-queues').onclick = () => this.loadTransferQueues();
    customLog("attached shadow");
    window.shadowRoot = this.shadowRoot;
    this.interactionId = null;
  }

  listen(service, event, handler) {
    service.addEventListener(event, handler);
    this.desktopListeners.push({ service, event, handler });
  }

  showClaimStatus(message, failed = false) {
    const status = this.shadowRoot.getElementById('claim-status');
    status.textContent = message;
    status.style.color = failed ? '#c62828' : 'inherit';
  }

  async claimButtonClick(self, event){
    if (self.claimInFlight || self.transferPickInFlight) return;
    const taskId = event.id.replace(/-button$/, '');
    const claimButton = this.shadowRoot.getElementById(event.id);
    const loadingIcon = this.shadowRoot.getElementById(taskId + '-loading');
    self.claimInFlight = true;
    self.clearWebRtcAccept();
    claimButton.disabled = true;
    loadingIcon?.classList.remove('invisible');
    self.showClaimStatus('Requesting this call from Webex…');
    try {
      const result = await self.assignTask(taskId);
      self.prepareWebRtcAccept(taskId);
      self.showClaimStatus(`Webex accepted the Claim request (HTTP ${result.status}). Waiting for call delivery. If it does not arrive, check the queue manual-assignment setting, your multimedia profile’s manual telephony capacity, and agent eligibility.`);
      await self.getTasks(self);
    } catch (error) {
      self.showClaimStatus(error.message, true);
    } finally {
      self.claimInFlight = false;
      claimButton.disabled = false;
      loadingIcon?.classList.add('invisible');
    }
  }

  captureQueueSession(event) {
    const sessionId = event?.data?.agentSessionId || event?.agentSessionId || Desktop.agentStateInfo.latestData?.agentSessionId;
    if (typeof sessionId !== 'string' || !sessionId || sessionId === this.queueAgentSessionId) return;
    const changedSession = this.queueAgentSessionId && this.queueAgentSessionId !== sessionId;
    this.queueAgentSessionId = sessionId;
    if (changedSession) {
      this.transferQueues = [];
      this.shadowRoot.getElementById('transfer-queue').value = '';
    }
    if (this.isConnected) this.loadTransferQueues();
  }

  async loadTransferQueues() {
    const status = this.shadowRoot.getElementById('transfer-queue-status');
    if (this.loadingTransferQueues) {
      status.textContent = 'Queue lookup is still running. It will time out after 15 seconds if Webex does not respond.';
      return;
    }
    if (this.transferPickInFlight) {
      status.textContent = 'Wait for Transfer & pick to finish before refreshing queues.';
      return;
    }
    this.loadingTransferQueues = true;
    const refresh = this.shadowRoot.getElementById('refresh-transfer-queues');
    refresh.disabled = true;
    refresh.textContent = 'Refreshing…';
    const select = this.shadowRoot.getElementById('transfer-queue');
    status.style.color = 'inherit';
    status.textContent = 'Loading your voice queues…';
    try {
      const ownerToken = await withDeadline(() => agentToken(), 10000, 'Agent identity lookup timed out. Refresh queues to retry.');
      const queues = await loadAvailableTransferQueues(Desktop, undefined, { agentSessionId: this.queueAgentSessionId, ownerToken });
      if (!this.isConnected) return;
      const previous = select.value;
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = ''; placeholder.textContent = 'Select a queue'; select.appendChild(placeholder);
      for (const queue of queues) {
        const option = document.createElement('option');
        option.value = queue.id; option.textContent = queue.name; select.appendChild(option);
      }
      this.transferQueues = queues;
      select.value = queues.some(queue => queue.id === previous) ? previous : '';
      status.textContent = queues.length ? `Loaded ${queues.length} voice transfer queue${queues.length === 1 ? '' : 's'}. Select a destination queue.` : 'Webex returned no voice transfer queues for this session. If transfer targets are set to All, sign out and back in to Agent Desktop, then refresh.';
    } catch (error) {
      status.textContent = error?.message || 'Queue lookup failed without an error description. Reload Agent Desktop and retry.';
      status.style.color = '#c62828';
    } finally {
      this.loadingTransferQueues = false;
      refresh.disabled = !!this.transferPickInFlight;
      refresh.textContent = 'Refresh queues';
    }
  }

  async checkPickedCall(taskId) {
    const token = await agentToken();
    const from = Math.min(Number(queueTasks[taskId]?.createdTime) || Date.now(), Date.now() - 600000) - 1;
    const response = await withDeadline(() => fetch(`${settings.wxccApiBaseUrl}/v1/tasks?from=${from}`, {
      headers: { Authorization: `Bearer ${token}` }
    }), 15000, 'Could not verify the picked call.');
    if (!response.ok) throw new Error(`Cannot verify the picked call (HTTP ${response.status}).`);
    const data = await response.json();
    const task = data.data?.find(row => row.id === taskId)?.attributes;
    if (!task || !['queued', 'created'].includes(task.status)) throw new Error('The picked call is no longer queued.');
  }

  async transferAndPick(taskId) {
    if (this.transferPickInFlight || this.claimInFlight) return;
    const select = this.shadowRoot.getElementById('transfer-queue');
    const queue = this.transferQueues?.find(item => item.id === select.value);
    if (!queue) { this.showClaimStatus('Select a destination queue for the active call first.', true); return; }
    this.transferPickInFlight = true;
    select.disabled = true;
    this.shadowRoot.getElementById('refresh-transfer-queues').disabled = true;
    this.updateButtonStates(agentIsOnCall);
    try {
      const wrapup = configuredTransferWrapup(Desktop, settings);
      this.transferWrapupTasks = new Set();
      const getTasks = () => withDeadline(() => Desktop.actions.getTaskMap(), 10000, 'Agent task lookup timed out; check the current call before retrying.');
      const current = voiceTasks(await getTasks());
      if (current.length !== 1) throw new Error('Exactly one current voice call is required.');
      this.clearWebRtcAccept();
      const result = await transferThenClaim({
        activeId: current[0].id, pickedId: taskId, queueId: queue.id, getTasks,
        checkPicked: () => this.checkPickedCall(taskId),
        transfer: (id, queueId) => withDeadline(() => Desktop.agentContact.vteamTransferV2({
          interactionId: id, data: { to: queueId, destinationType: 'queue' }
        }), 30000, 'Transfer confirmation timed out. Check the current call; the picked call was not claimed.'),
        wrapup, isWrappingUp: id => this.transferWrapupTasks?.has(id),
        claim: id => this.assignTask(id),
        onStatus: message => this.showClaimStatus(message),
        isConnected: () => this.isConnected
      });
      this.prepareWebRtcAccept(taskId);
      this.showClaimStatus(`Active call transferred to ${queue.name}. Webex accepted the picked call (HTTP ${result.status}). Use Accept browser call as usual.`);
      await this.getTasks(this);
    } catch (error) { this.showClaimStatus(error.message, true); }
    finally {
      this.transferWrapupTasks = null;
      this.transferPickInFlight = false;
      select.disabled = false;
      this.shadowRoot.getElementById('refresh-transfer-queues').disabled = false;
      this.updateButtonStates(agentIsOnCall);
    }
  }

  prepareWebRtcAccept(taskId) {
    if (settings.webRtcEnabled === false) return;
    this.webRtcTaskId = taskId;
    const button = this.shadowRoot.getElementById('webrtc-accept');
    button.hidden = false;
    button.disabled = false;
    button.onclick = () => this.acceptBrowserCall();
    this.shadowRoot.getElementById('webrtc-status').textContent = 'For Desktop/browser audio: click Accept browser call when the claimed call arrives.';
    clearTimeout(this.webRtcExpiry);
    this.webRtcExpiry = setTimeout(() => {
      this.clearWebRtcAccept();
      this.shadowRoot.getElementById('webrtc-status').textContent = 'The browser answer window expired. Check the call in Agent Desktop before claiming again.';
    }, 60000);
  }

  clearWebRtcAccept() {
    clearTimeout(this.webRtcExpiry);
    this.webRtcTaskId = null;
    this.shadowRoot.getElementById('webrtc-accept').hidden = true;
    this.shadowRoot.getElementById('webrtc-status').textContent = '';
  }

  async acceptBrowserCall() {
    const button = this.shadowRoot.getElementById('webrtc-accept');
    if (this.webRtcAcceptInFlight) return;
    this.webRtcAcceptInFlight = true;
    button.disabled = true;
    const status = this.shadowRoot.getElementById('webrtc-status');
    try {
      await acceptClaimedWebRtcCall(Desktop.actions, this.webRtcTaskId);
      status.textContent = 'Answer request sent to Agent Desktop. Confirm that the call timer starts and you can hear the caller.';
    } catch (error) {
      status.textContent = error.message;
    } finally {
      this.webRtcAcceptInFlight = false;
      button.disabled = false;
    }
  }

  async conferenceButtonClick(self, event){
    if (self.transferPickInFlight || self.claimInFlight) return;
    if (!settings.conferenceEnabled || !settings.holdExtension || !settings.wrapUpCodeId) {
      self.updateResultSpan('Configure the hold destination and wrap-up code before conferencing.', 'red');
      return;
    }
    try{
      customLog("conferenceButtonClick:");
      customLog(event);
      let taskId = event.id.split("-conference-button")[0];
      const conferenceButton = this.shadowRoot.getElementById(event.id);
      const loadingIcon = this.shadowRoot.getElementById(taskId+"-loading");
      
      conferenceButton.style.display = "none";
      loadingIcon.classList.remove("invisible");
      customLog(taskId);
      
      setTimeout(function(){
        loadingIcon.classList.add("invisible");
        try{
          customLog(`status of ${taskId} after conference click:`)
          customLog(queueTasks[taskId].status);
          if(["queued", "created"].indexOf(queueTasks[taskId].status) >= 0){
            conferenceButton.style.display = (agentIsOnCall && settings?.conferenceEnabled) ? "inline-block" : "none";
          }
        }catch(ex){
          customLog("conferenceButton Timeout error:");
          customLog(ex);
          conferenceButton.style.display = (agentIsOnCall && settings?.conferenceEnabled) ? "inline-block" : "none";
        }
      },10000);
      const interaction = await this.getInteraction();
      customLog(interaction);
      customLog("interaction.contactDirection.type:", interaction.contactDirection?.type);
      var trackNumber = interaction.callAssociatedDetails.ani;
      if(interaction.contactDirection?.type === "OUTBOUND"){
        trackNumber = interaction.callAssociatedDetails.dn;
      }
      customLog("interaction trackNumber:", trackNumber);
      const transferTaskId = interaction.interactionId;
      trackedTransferPayload = {
        command: "transfer-hold",
        owner: interaction.owner,
        transferTaskId: transferTaskId,
        number: trackNumber,
        agentNumber: window.agentDetails?.extension,
        direction: interaction.contactDirection
      };
      await backendPost('transfer-state.php', trackedTransferPayload);
      previousCallNumber = trackNumber;
      
      // Show merge panel
      showMergePanel = true;
      const mergePanel = self.shadowRoot.getElementById('merge-panel');
      const mergeCallerNumber = self.shadowRoot.getElementById('merge-caller-number');
      if (mergePanel && mergeCallerNumber) {
        mergeCallerNumber.textContent = trackNumber;
        mergePanel.classList.remove('invisible');
      }
      await self.transferTask(settings.holdExtension, transferTaskId);
      await self.wrapUpTask(transferTaskId);
      await self.assignTask(taskId);
    }catch(e){
      self.updateResultSpan(e.message, 'red');
    }
  }

  getTimestampRow(task){
    const createdAgo = makeStringTime(task.createdTime);
    const updatedAgo = makeStringTime(task.lastUpdatedTime);
    return `<td class="column-one">Age: ${createdAgo}</td><td>Last updated: ${updatedAgo}</td>`;
  }


  addTask(taskId, task){
    try{
      customLog('addTask, task:', null, "task-loop");
      customLog(task, null, "task-loop");
      const card = document.createElement("div");
      card.id = taskId;
      card.dataset.updated = `${task.lastUpdatedTime}`;
      card.classList.add('card');

      const container = document.createElement("div");
      container.id = taskId+"-container";
      container.classList.add('container');
      let filterStatus = task.status;
      if(["queued", "created"].indexOf(task.status) < 0){
        container.classList.add('faded');
        card.dataset.status = task.status;
      } else {
        filterStatus = "queued";
        card.dataset.status = "queued";
      }

      const table = document.createElement("table");

      let callerName = ""
      if(callerIds[taskId]?.Headers){
        try{
          callerName = callerIds[taskId].Headers.split("caller_id_name=")[1];
          callerName = callerName.split("}")[0];
          callerName = `(${escapeHtml(callerName)})`
        } catch(ex){
          customLog('addTask callerId split error:', null, "task-loop");
          customLog(ex, null, "task-loop");
        }
      }
      const row1 = document.createElement("tr");
      row1.innerHTML = `<td class="column-one origin-cell"><h4><b>${escapeHtml(task.origin)}</b></h4></td><td><h4>${escapeHtml(callerName)}</h4></td>`
      const lastCell = document.createElement("td");
      if(["queued", "created"].indexOf(task.status) >= 0){
        let self = this;

        // Create Claim button
        const claimButton = document.createElement("button");
        claimButton.id = taskId + "-button";
        claimButton.classList.add("flat-rounded-button");
        claimButton.innerHTML = "Claim";
        claimButton.style.display = agentIsOnCall ? "none" : "inline-block";
        claimButton.addEventListener('click', async function(event){
          await self.claimButtonClick(self, this)
        });
        lastCell.appendChild(claimButton);
        const transferPickButton = document.createElement('button');
        transferPickButton.id = taskId + '-transfer-pick';
        transferPickButton.classList.add('flat-rounded-button');
        transferPickButton.textContent = 'Transfer & pick';
        transferPickButton.style.display = agentIsOnCall ? 'inline-block' : 'none';
        transferPickButton.disabled = !!this.transferPickInFlight;
        transferPickButton.addEventListener('click', () => this.transferAndPick(taskId));
        lastCell.appendChild(transferPickButton);

        // Create Conference button
        const conferenceButton = document.createElement("button");
        conferenceButton.id = taskId + "-conference-button";
        conferenceButton.classList.add("flat-rounded-conference-button");
        conferenceButton.innerHTML = "Conference";
        conferenceButton.style.display = (agentIsOnCall && settings?.conferenceEnabled) ? "inline-block" : "none";
        conferenceButton.addEventListener('click', async function() {
          await self.conferenceButtonClick(self, this);
        });
        lastCell.appendChild(conferenceButton);

        // Single loading icon for both buttons
        const loadingImg = document.createElement("img");
        loadingImg.id = taskId+"-loading";
        loadingImg.src = `${assetBase.replace(/\/$/, "")}/img/loading-1.gif`;
        loadingImg.classList.add("button-loading-icon");
        loadingImg.classList.add("invisible");
        lastCell.appendChild(loadingImg);
        
      }
      row1.appendChild(lastCell);
      table.appendChild(row1);
      
      const row2 = document.createElement("tr");
      row2.innerHTML = `<td id="${taskId}-status" class="column-one">${capitalizeFirstLetter(task.status)}</td><td>${escapeHtml(task.queue?.name)}</td>`;
      table.appendChild(row2);

      const row3 = document.createElement("tr");
      row3.id = taskId + "-timestamps";
      row3.innerHTML = this.getTimestampRow(task);
      table.appendChild(row3);

      container.appendChild(table);
      card.appendChild(container);

      let statusType = this.shadowRoot.getElementById(filterStatus);
      if(statusType && !statusType.checked){
        card.classList.add("hidden");
      }

      customLog(this.shadowRoot.getElementById("my-queue"), null, "task-loop");
      this.shadowRoot.getElementById("my-queue").prepend(card);
      customLog(`appended task ${taskId} to my-queue`, null, "task-loop");
      
      if(!statusType || statusType.checked){
        setTimeout(function(){
          card.classList.add('animate');
        },100);
      }
    }catch(e){
      customLog(`addTask Error:`, null, "task-loop");
      customLog(e, null, "task-loop");
    }  
  }

  updateTask(taskId, task){
    try{
      customLog('updateTask, task:', null, "task-loop");
      customLog(task, null, "task-loop");
      const card = this.shadowRoot.getElementById(taskId);
      card.dataset.updated = `${task.lastUpdatedTime}`;
      this.shadowRoot.getElementById(taskId+"-status").innerText = capitalizeFirstLetter(task.status);
      this.shadowRoot.getElementById(taskId+"-timestamps").innerHTML = this.getTimestampRow(task);
      if(["queued", "created"].indexOf(task.status) < 0){
        if(task.status !== card.dataset.status){
          card.dataset.status = task.status;
          this.filterTasks();
        }
        
        this.shadowRoot.getElementById(taskId+"-container").classList.add('faded');
        let button = this.shadowRoot.getElementById(taskId+"-button");
        let loadingIcon = this.shadowRoot.getElementById(taskId+"-loading");
        let conferenceButton = this.shadowRoot.getElementById(taskId+"-conference-button");
        const transferPickButton = this.shadowRoot.getElementById(taskId + '-transfer-pick');
        if (transferPickButton) transferPickButton.style.display = 'none';
        if(button){
          button.style.display = "none";
        }
        if(loadingIcon){
          loadingIcon.classList.add("invisible");
        }
        if(conferenceButton){
          conferenceButton.style.display = "none";
        }
      } else {
        if(task.status !== card.dataset.status){
          card.dataset.status = "queued";
          this.filterTasks();
        }
      }
    }catch(e){
      customLog("updateTask error:");
      customLog(e);
    }
  }

  removeTask(taskId){
    let card = this.shadowRoot.getElementById(taskId);
    card.classList.remove('animate');
    setTimeout(function(){
      card.remove();
    },500);
  }

  updateButtonStates(isOnCall){
    agentIsOnCall = isOnCall;
    this.shadowRoot.getElementById('queue-transfer-panel').hidden = !isOnCall && !this.transferPickInFlight;
    for (const button of this.shadowRoot.querySelectorAll('[id$="-transfer-pick"]')) {
      const card = this.shadowRoot.getElementById(button.id.replace(/-transfer-pick$/, ''));
      button.style.display = isOnCall && card?.dataset.status === 'queued' ? 'inline-block' : 'none';
      button.disabled = !!this.transferPickInFlight || !!this.claimInFlight;
    }
    for (const button of this.shadowRoot.querySelectorAll('[id$="-button"]')) button.disabled = !!this.transferPickInFlight || !!this.claimInFlight;
    
    // Only update buttons on cards that are still queued (active); leave deactivated cards alone
    const confButtons = this.shadowRoot.querySelectorAll('[id$="-conference-button"]');
    confButtons.forEach(button => {
      const taskId = button.id.split("-conference-button")[0];
      const card = this.shadowRoot.getElementById(taskId);
      if (!card || card.dataset.status !== "queued") return; // Deactivated card: don't touch
      const loadingIcon = this.shadowRoot.getElementById(taskId + "-loading");
      if(!loadingIcon || loadingIcon.classList.contains("invisible")){
        button.style.display = (isOnCall && settings?.conferenceEnabled) ? "inline-block" : "none";
      }
    });
    
    const claimButtons = this.shadowRoot.querySelectorAll('[id$="-button"]:not([id$="-conference-button"])');
    claimButtons.forEach(button => {
      const taskId = button.id.split("-button")[0];
      const card = this.shadowRoot.getElementById(taskId);
      if (!card || card.dataset.status !== "queued") return; // Deactivated card: don't touch
      const loadingIcon = this.shadowRoot.getElementById(taskId + "-loading");
      if(!loadingIcon || loadingIcon.classList.contains("invisible")){
        button.style.display = isOnCall ? "none" : "inline-block";
      }
    });
    
    customLog(`Updated buttons: agentIsOnCall = ${isOnCall}`);
  }

  async wrapUpTask(taskId){
    customLog(`wrapUpTask taskId:${taskId}`);
    try{
      const wrapUpResp = await fetch(`${settings.wxccApiBaseUrl}/v1/tasks/${taskId}/wrapup`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await agentToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "auxCodeId": settings.wrapUpCodeId,
          "wrapUpReason": "Conference"
        })
      });
      if (!wrapUpResp.ok) throw new Error(`Wrap-up failed (${wrapUpResp.status})`);
      customLog(`wrapUpResp.status:${wrapUpResp.status}`);
    }catch(e){
      throw e;
    }
  }

  async transferTask(extension, taskId){
    customLog(`transferTask extension:${extension}`);
    customLog(`transferTask taskId:${taskId}`); 
    try{
      const transferResp = await fetch(`${settings.wxccApiBaseUrl}/v1/tasks/${taskId}/transfer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await agentToken()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          "to": extension,
          "destinationType": "dialNumber"
        })
      });
      if (!transferResp.ok) throw new Error(`Transfer failed (${transferResp.status})`);
      customLog(`transferResp.status:${transferResp.status}`);
      return taskId;
    }catch(e){
      throw e;
    }
  }

  async assignTask(taskId){
    return assignVoiceTask(settings.wxccApiBaseUrl, taskId, await agentToken());
  }

  async getTasks(self){
    if (self.polling || !self.isConnected) return;
    self.polling = true;
    try{
        //const pastSeconds = 1800; //1800 seconds = 30 minutes;
        const pastSeconds = 600;
        const fromEpochSeconds = Math.floor(Date.now()) - (pastSeconds * 1000);
        const tasksResp = await fetch(`${settings.wxccApiBaseUrl}/v1/tasks?from=${fromEpochSeconds}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${await agentToken()}`,
            'Content-Type': 'application/json'
          }
        });
        customLog(`tasksResp.status:${tasksResp.status}`, null, "task-loop");
        if (!tasksResp.ok) throw new Error(`Tasks request failed (${tasksResp.status})`);
        let json = await tasksResp.json();
        if (!self.isConnected) return;
        customLog(json, null, "task-loop");
        let tempTasks = {};
        if(json.data?.length > 0){
          let missingCallerIdTasks = [];
          for(let i of json.data){
            tempTasks[i.id] = i.attributes;
            if(!callerIds.hasOwnProperty(i.id)){
              missingCallerIdTasks.push(i.id);
            }
          }
          if(missingCallerIdTasks.length > 0){
            let newCallerIds = [];
            try { newCallerIds = await getCallerIds(missingCallerIdTasks); }
            catch (error) { self.updateResultSpan(`Caller details: ${error.message}`, 'red'); }
            customLog("newCallerIds:");
            customLog(newCallerIds);
            mergeCallerIds(callerIds, newCallerIds);
            for (const row of newCallerIds) {
              if (row.found && self.shadowRoot.getElementById(row.InteractionId)) {
                self.shadowRoot.getElementById(row.InteractionId).remove();
              }
            }
            window.callerIds = callerIds;
          }

          customLog('tempTasks', null, "task-loop");
          customLog(tempTasks, null, "task-loop");

          queueTasks = tempTasks;
          for(let task of Object.keys(tempTasks)){
            let existingCard = self.shadowRoot.getElementById(task)
            if(existingCard){
              customLog('updateTask', task, "task-loop");
              self.updateTask(task, tempTasks[task]);
            } else {
              customLog('newTask', task, "task-loop");
              self.addTask(task, tempTasks[task]);
            }
          }
        }

        for(let card of self.shadowRoot.querySelectorAll(".card")){
          if(fromEpochSeconds > card.dataset.updated){
              customLog('old card', card.id);
              try{
                delete callerIds[card.id];
                delete queueTasks[card.id];
                self.removeTask(card.id);
              }catch(ex){
                customLog("Error with oldTask:");
                customLog(ex);
              }
          }
        }
    } catch(e){
      self.updateResultSpan(e.message, 'red');
    } finally { self.polling = false; }

  }


  filterTasks(){
    let checked = []
    let unchecked = []
    for(let checkbox of queueStatuses){
      let elem = this.shadowRoot.getElementById(checkbox);
      if(elem.checked){
        checked.push(checkbox);
      } else {
        unchecked.push(checkbox);
      }
    }
    customLog("unchecked", unchecked);
    customLog("checked", checked);
    for(let node of this.shadowRoot.querySelectorAll(`.card`)){
      customLog(node);
      if(checked.indexOf(node.dataset.status) >= 0){
        node.classList.remove("hidden");
        setTimeout(function(){
          node.classList.add("animate");
        },200);
      }else{
        node.classList.remove('animate');
        setTimeout(function(){
          node.classList.add("hidden");
        },300);
      }
    }
  }


  async init() {
      customLog("Running Desktop config.init();")
      await Desktop.config.init({ widgetName: "Cherry Picker", widgetProvider: "Custom" });
      try{
        // ************************** Event listeners ************************** \\

        window.shadowRoot = this.shadowRoot;
        customLog("window.shadowRoot set.");
        customLog(window.shadowRoot);
        customLog(this.shadowRoot);

        for(let checkbox of queueStatuses){
          try{
            addOrReplaceEventListener( this.shadowRoot.getElementById(checkbox), 'change', e => {
              customLog(`${checkbox} change`);
              Cookies.set(checkbox, e.currentTarget.checked);
              this.filterTasks();
            });
          } catch(e){
            customLog(`Error: Listener not attached for ${checkbox} elements`);
            customLog(e);
          }
        }

        customLog("Initialized Buttons.")
        initResult = true;
      } catch (e){
        customLog("init Error:", e);
        initResult = false;
      }
  }

  // Get interactionID, but more info can be obtained from this method
  async getInteractionId() {
    const currentTaskMap = await Desktop.actions.getTaskMap();
    for (const iterator of currentTaskMap) {
      const interId = iterator[1].interactionId;
      return interId;
    }
  }

  async getInteraction() {
    const currentTaskMap = await Desktop.actions.getTaskMap();
    for (const iterator of currentTaskMap) {
      const interId = iterator[1].interaction;
      return interId;
    }
  }


  showLoadingIcon(message, color){
    this.updateResultSpan(message, color);
    this.shadowRoot.getElementById("queue-content").style.display = "none";
    this.shadowRoot.getElementById("loading-icon").style.display = "block";
  }

  showQueueDiv(message, color){
    this.updateResultSpan(message, color);
    this.shadowRoot.getElementById("loading-icon").style.display = "none";
    this.shadowRoot.getElementById("queue-content").style.display = "block";
  }


  updateResultSpan(text, color){
    if(!text){
      text = "";
    } else {
      customLog(`updateResultSpan text:${text}`);
    }
    this.shadowRoot.getElementById("result-span").innerText = text;
    if(!color){
      color = "inherit";
    }
    this.shadowRoot.getElementById("result-span").style.color = color;
  }


    async loadContent(){
      try{
        const checkSeconds = settings.pollIntervalMs / 1000
        let self = this;

        for(let filter of queueStatuses){
          customLog(filter, Cookies.get(filter));
          if(Cookies.get(filter) === "false"){
            this.shadowRoot.getElementById(filter).checked = false;
          }
        }

        // Check if agent is already on a call and set initial state
        const currentTaskMap = await Desktop.actions.getTaskMap();
        if (!self.isConnected) return;
        const isOnCall = voiceTasks(currentTaskMap).length > 0;
        customLog(`Initial call state - isOnCall: ${isOnCall}`);
        this.updateButtonStates(isOnCall);

        await self.getTasks(self);
        if (!self.isConnected) return;
        clearInterval(this.taskTimer);
        clearInterval(this.stateTimer);
        this.taskTimer = setInterval(async function(){
          await self.getTasks(self);
        }, checkSeconds * 1000);

        // Periodically check and update button states to stay in sync
        this.stateTimer = setInterval(async function(){
          try {
          const currentTaskMap = await Desktop.actions.getTaskMap();
          const isOnCall = voiceTasks(currentTaskMap).length > 0;
          if(isOnCall !== agentIsOnCall){
            customLog(`Button state sync - updating to ${isOnCall}`);
            self.updateButtonStates(isOnCall);
          }
          } catch (error) { self.updateResultSpan(error.message, 'red'); }
        }, 1000); // Check every second
        
        this.showQueueDiv();
        
        // Setup merge button handler (must be done every time widget loads)
        const mergeButton = this.shadowRoot.getElementById('merge-button');
        if (mergeButton) {
          mergeButton.addEventListener('click', async function() {
            customLog("Merge button clicked");
            
            if (!trackedTransferPayload) {
              customLog("No trackedTransferPayload available");
              return;
            }
            
            // Disable button for 10 seconds
            mergeButton.disabled = true;
            setTimeout(() => {
              mergeButton.disabled = false;
            }, 10000);
            
            // Save transfer state with transfer-merge command
            const mergePayload = {
              ...trackedTransferPayload,
              command: "transfer-merge"
            };
            
            customLog("Sending transfer-merge message:", mergePayload);
            try {
              await backendPost('transfer-state.php', mergePayload);
              self.updateResultSpan('Merge requested. Waiting for the held call to return.');
            } catch (error) {
              self.updateResultSpan(error.message, 'red');
              mergeButton.disabled = false;
            }
          });
          customLog("Merge button handler initialized");
        }
        
        // Restore merge panel state if needed (after widget reload)
        if (showMergePanel && trackedTransferPayload) {
          customLog("Restoring merge panel state after widget reload");
          const mergePanel = this.shadowRoot.getElementById('merge-panel');
          const mergeCallerNumber = this.shadowRoot.getElementById('merge-caller-number');
          if (mergePanel && mergeCallerNumber) {
            mergeCallerNumber.textContent = trackedTransferPayload.number || previousCallNumber;
            mergePanel.classList.remove('invisible');
            customLog("Merge panel restored with number:", trackedTransferPayload.number);
          }
        }
      }catch(e){
        customLog("loadContent Error:");
        customLog(e);
      }
      
  }

  async connectedCallback() {
    try{
      customLog("connectedCallback")
      // Update the global reference to the current widget instance
      currentWidgetInstance = this;
      await configReady;
      await this.cookiesReady;
      if (!this.isConnected) return;
      await this.init();
      customLog("initResult:");
      customLog(initResult);
      if(!initResult){
        throw new Error("Not initialized!");
      }
      customLog("Desktop.agentStateInfo.latestData", Desktop.agentStateInfo.latestData);
      if(!loaded){

        Cookies.get("queued");


        customLog("myINIT:", Desktop.agentContact)
        //customLog("myINIT accessToken:", Desktop.agentContact.SERVICE.webex.accessToken);
        
        window.myAgentService = Desktop.agentContact.SERVICE;
        window.ccDesktop = Desktop;
        window.lastBroadworksId = null;
        if (settings.conferenceEnabled) {
          fetch('https://webexapis.com/v1/people/me', { headers: { Authorization: `Bearer ${await agentToken()}` } })
            .then(response => { if (!response.ok) throw new Error('Cannot read agent extension'); return response.json(); })
            .then(person => { window.agentDetails = { ...person, extension: person.phoneNumbers?.find(number => number.type?.includes('extension'))?.value }; })
            .catch(error => this.updateResultSpan(error.message, 'red'));
        }

        this.listen(Desktop.agentStateInfo, 'updated', (contact) => {
            customLog('New state updated received:', contact);
            this.captureQueueSession(contact);
        });

        for (const event of ['eAgentChannelStateChanged', 'eAgentChannelReloginSuccess', 'eAgentReloginSuccess']) {
          this.listen(Desktop.agentStateInfo, event, contact => this.captureQueueSession(contact));
        }

        let self = this;
        this.listen(Desktop.agentContact, 'eAgentOfferContact', (contact) => {
            customLog('New eAgentOfferContact received:', contact);
            const taskId = contact.data?.interactionId || contact.interactionId;
            if (taskId && taskId === self.webRtcTaskId) self.shadowRoot.getElementById('webrtc-status').textContent = 'Webex reported an offer for this call. Click Accept browser call.';
            let loadingIcon = self.shadowRoot.getElementById(taskId+"-loading");
            customLog(loadingIcon);
            loadingIcon?.classList.add("invisible");
        });

        // Enable Conference buttons when agent answers a call
        this.listen(Desktop.agentContact, 'eAgentContactAssigned', (contact) => {
            customLog('Agent answered call - enabling Conference buttons');
            self.updateButtonStates(true); // Agent is on call
        });

        // Disable Conference buttons when agent's call ends
        this.listen(Desktop.agentContact, 'eAgentContactEnded', (contact) => {
            customLog('Agent call ended - disabling Conference buttons');
            self.clearWebRtcAccept();
            self.updateButtonStates(false); // Agent is not on call
        });

        // Also handle when agent wraps up (task ends)
        this.listen(Desktop.agentContact, 'eAgentWrapup', (contact) => {
            customLog('Agent entered wrapup - disabling Conference buttons');
            const id = contact.data?.interactionId || contact.interactionId;
            if (id && self.transferPickInFlight) self.transferWrapupTasks?.add(id);
            self.clearWebRtcAccept();
            self.updateButtonStates(false); // Agent is not on call
        });

        // Handle when contact ends
        this.listen(Desktop.agentContact, 'eContactEnded', (contact) => {
            customLog('Contact ended - disabling Conference buttons');
            self.clearWebRtcAccept();
            self.updateButtonStates(false); // Agent is not on call
        });
        
        this.loadTransferQueues();
        await this.loadContent();

        const webexService = Desktop.agentContact.SERVICE?.webex;
        if (settings.conferenceEnabled && webexService?.meetings && webexService?.internal?.mercury) {
        webexService.meetings.register().then(res => {
          customLog("webexService.meetings.register() done!");
          try{
            return webexService.internal.mercury.connect().then(() => {
                customLog("Mercury Connected.");

                if (!self.isConnected) return;
                self.mercury = webexService.internal.mercury;
                self.mercuryHandler = async (event) => {
                    customLog("mercury telephony_calls.received EVENT:");
                    customLog(event);
                    var callingToken = Desktop.agentContact.SERVICE.webexCalling.getAccessTokenFunc();
                    previousCall = structuredClone(currentCall);
                    customLog("previousCall:", previousCall);
                    currentCall = structuredClone(event);
                    customLog("currentCall:", currentCall);
                    try {   
                        // Start conference with active calls - only if merge operation is pending
                        if(showMergePanel === true && 
                           previousCallNumber && 
                           previousCall?.data?.callId &&
                           previousCallNumber === currentCall.data?.remoteParty?.number){
                          customLog("Auto-merge conditions met - previousCallNumber matches and merge panel is active");
                          const conferenceResponse = await fetch('https://webexapis.com/v1/telephony/conference', {
                              method: 'POST',
                              headers: {
                                  'Authorization': `Bearer ${callingToken}`,
                                  'Content-Type': 'application/json'
                              },
                              body: JSON.stringify({
                                  callIds: [previousCall.data.callId, currentCall.data.callId]
                              })
                          });
                          
                          if (conferenceResponse.ok) {
                              customLog("Conference started successfully:");
                              
                              // Hide merge panel after successful conference
                              showMergePanel = false;
                              
                              // Use the current widget instance (updated on each reload)
                              if (currentWidgetInstance && currentWidgetInstance.shadowRoot) {
                                const mergePanel = currentWidgetInstance.shadowRoot.getElementById('merge-panel');
                                customLog("Found merge panel:", mergePanel);
                                if (mergePanel) {
                                  mergePanel.classList.add('invisible');
                                  customLog("Merge panel hidden");
                                } else {
                                  customLog("Merge panel not found in current shadowRoot");
                                }
                              } else {
                                customLog("currentWidgetInstance or shadowRoot not available");
                              }
                              
                              // Clear tracked transfer payload
                              trackedTransferPayload = null;
                              previousCallNumber = null;
                          } else {
                              customLog(`Error starting conference: ${conferenceResponse.status} ${conferenceResponse.statusText}`);
                              const errorData = await conferenceResponse.json();
                              customLog(errorData);
                              
                              // Clear variables on error to prevent future accidental merges
                              customLog("Clearing merge state due to conference error");
                              showMergePanel = false;
                              trackedTransferPayload = null;
                              previousCallNumber = null;
                          }
                        }
                    } catch (error) {
                        customLog("Error handling telephony_calls.received event:");
                        customLog(error);
                    }
                };
                self.mercury.on('event:telephony_calls.received', self.mercuryHandler);
                customLog("initialized calling listener");
            });
          }catch(e){
            customLog("webexService.meetings.register() error:");
            customLog(e);
          }
        }).catch(error => self.updateResultSpan(`Calling: ${error.message}`, 'red'));

        }
        customLog("loaded = true");
        loaded = true;
      } else {
        customLog("webex already loaded.");
        await this.loadContent();
      }
    }catch(e){
      this.updateResultSpan(e.message, 'red');
      let self = this;
      this.retryTimer = setTimeout(async function(){
        if (!self.isConnected) return;
        try{
          customLog("Trying to reload...");
          await self.connectedCallback();
        }catch(ex){
          customLog("setTimeout connectedCallback attempt error:");
          customLog(ex);
        }
      }, 3000);
    }
  }

  disconnectedCallback() {
    clearInterval(this.taskTimer);
    clearInterval(this.stateTimer);
    clearTimeout(this.retryTimer);
    this.clearWebRtcAccept();
    for (const { service, event, handler } of this.desktopListeners) service.removeEventListener(event, handler);
    this.desktopListeners = [];
    if (this.mercury && this.mercuryHandler) this.mercury.off('event:telephony_calls.received', this.mercuryHandler);
    loaded = false;
    if (currentWidgetInstance === this) currentWidgetInstance = null;
  }

}

if (!customElements.get("sa-ds-voice-sdk")) customElements.define("sa-ds-voice-sdk", myDesktopSDK);
