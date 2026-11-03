export function voiceTasks(tasks) {
  if (!tasks || typeof tasks.entries !== 'function') throw new Error('Agent Desktop task information is unavailable.');
  return [...tasks.entries()].filter(([, task]) => {
    const media = task.interaction?.mediaType || task.interaction?.mediaChannel || task.mediaType;
    return ['telephony', 'voice'].includes(String(media).toLowerCase());
  }).map(([key, task]) => ({ id: task.interactionId || task.interaction?.interactionId || key, task }));
}

export function normalizeQueues(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const list = raw instanceof Map ? [...raw.values()] : Array.isArray(raw) ? raw :
    raw.vteamList || raw.queues || raw.data || Object.values(raw);
  if (!Array.isArray(list)) return normalizeQueues(list);
  const unique = new Map();
  for (const row of list) {
    const id = row?.id ?? row?.queueId ?? row?.value;
    const name = row?.name ?? row?.queueName ?? row?.label;
    const media = row?.channelType ?? row?.mediaType;
    if (row?.type && row.type !== 'inboundqueue') continue;
    if (id == null || !name || (media && !['telephony', 'voice'].includes(String(media).toLowerCase()))) continue;
    unique.set(String(id), { id: String(id), name: String(name) });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Survives component recreation within this Desktop page. Never written to storage.
// Scope by current bearer identity and known profile/session; expire after 30 minutes.
const queueSnapshots = new WeakMap();
const queueSnapshotMaxAge = 30 * 60 * 1000;

// Fetch transfer targets directly: Desktop's media queue cache can be empty.
export async function loadAvailableTransferQueues(desktop, trackingId = () => globalThis.crypto.randomUUID(), sessionInfo = {}) {
  const { agentProfileID } = desktop.agentStateInfo.latestData || {};
  const agentSessionId = sessionInfo.agentSessionId || desktop.agentStateInfo.latestData?.agentSessionId;
  const owner = sessionInfo.ownerToken;
  let snapshot = queueSnapshots.get(desktop);
  if (snapshot && (!owner || snapshot.owner !== owner || Date.now() - snapshot.time > queueSnapshotMaxAge ||
      (agentProfileID && snapshot.profile && agentProfileID !== snapshot.profile) ||
      (agentSessionId && snapshot.session && agentSessionId !== snapshot.session))) {
    queueSnapshots.delete(desktop);
    snapshot = undefined;
  }
  const remember = queues => {
    if (owner) queueSnapshots.set(desktop, { owner, profile: agentProfileID, session: agentSessionId,
      time: Date.now(), queues: queues.map(queue => ({ ...queue })) });
    return queues;
  };
  if (!agentProfileID || !agentSessionId) {
    const cached = normalizeQueues(await withDeadline(
      () => desktop.actions.getMediaTypeQueue('telephony'), 15000,
      'Queue lookup timed out. Click Refresh queues to retry.'));
    if (cached.length) return remember(cached);
    // Answering a call can clear the SDK cache or recreate the widget. Retain the
    // previously successful list for this identity, without inventing a session ID.
    if (snapshot?.queues.length) return snapshot.queues.map(queue => ({ ...queue }));
    throw new Error(!agentProfileID
      ? 'The SDK has not supplied your Desktop profile ID. Reload Agent Desktop and retry.'
      : 'The SDK has not supplied the current agent session ID. After finishing your current call and wrap-up, change your voice availability state in Agent Desktop, then click Refresh queues.');
  }
  const response = await withDeadline(() => desktop.agentContact.vteamList({ data: {
    agentProfileId: agentProfileID, agentSessionId, channelType: 'telephony',
    type: 'inboundqueue', trackingId: trackingId()
  } }), 15000, 'Queue lookup timed out. Click Refresh queues to retry.');
  const types = [response?.type, response?.data?.type];
  if (types.includes('VteamListFailed')) {
    queueSnapshots.delete(desktop);
    throw new Error(`Webex could not retrieve transfer queues: ${response?.data?.reason || response?.reason || 'VteamListFailed'}`);
  }
  if (!types.includes('VteamList')) throw new Error('Webex did not return a confirmed transfer queue list. Click Refresh queues to retry.');
  return remember(normalizeQueues(response));
}

export async function withDeadline(operation, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([Promise.resolve().then(operation), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

export function configuredTransferWrapup(desktop, settings) {
  if (settings.autoWrapUpOnTransfer !== true) return undefined;
  const id = settings.wrapUpCodeId?.trim();
  const name = settings.transferWrapUpReason?.trim();
  if (!id || id.length > 36 || !name || name.length > 128) {
    throw new Error('Configure wrapUpCodeId and transferWrapUpReason in config.js before using automatic transfer wrap-up.');
  }
  if (typeof desktop.agentContact.wrapupV2 !== 'function') throw new Error('This SDK does not support wrapupV2.');
  return interactionId => withDeadline(() => desktop.agentContact.wrapupV2({
    interactionId, data: { auxCodeId: id, wrapUpReason: name, isAutoWrapup: true }
  }), 15000, 'Wrap-up confirmation timed out. Check Agent Desktop before retrying.');
}

// Never retry a transfer automatically: its result may be uncertain after a network timeout.
export async function transferThenClaim({ activeId, pickedId, queueId, getTasks, transfer, claim,
  checkPicked, wrapup, isWrappingUp = () => false, onStatus = () => {}, isConnected = () => true,
  wait = () => new Promise(resolve => setTimeout(resolve, 1000)), maxChecks = 90 }) {
  if (!queueId) throw new Error('Select a destination queue.');
  if (!activeId || activeId === pickedId) throw new Error('Select a different queued call.');
  const before = voiceTasks(await getTasks());
  if (before.length !== 1 || before[0].id !== activeId) throw new Error('The active call changed. Review it before transferring.');
  const state = String(before[0].task.interaction?.state || before[0].task.state || '').toLowerCase();
  if (/wrap|ended|completed|offered|ringing|alerting/.test(state)) throw new Error('The current voice task is not an active call that can be transferred.');
  await checkPicked();
  if (!isConnected()) throw new Error('Widget closed before transfer.');
  onStatus('Transferring the active call to the selected queue…');
  const response = await transfer(activeId, queueId);
  const types = [response?.type, response?.data?.type];
  if (!types.includes('AgentVteamTransferred')) {
    throw new Error(`Transfer was not confirmed. The picked call was not claimed. ${response?.data?.reason || response?.reason || types.filter(Boolean).join(', ') || 'Check the current call in Agent Desktop.'}`);
  }
  onStatus(wrapup ? 'Call transferred. Waiting to complete wrap-up automatically…' : 'Call transferred. Complete any wrap-up in Agent Desktop; the picked call will be claimed when your voice task clears.');
  let wrapupSubmitted = false;
  for (let attempt = 0; attempt < maxChecks; attempt++) {
    if (!isConnected()) throw new Error('Call transferred; widget closed before claiming the picked call.');
    const remaining = voiceTasks(await getTasks());
    if (remaining.some(task => task.id !== activeId)) throw new Error('Call transferred, but another voice task arrived. The picked call was not claimed.');
    const activeTask = remaining.find(task => task.id === activeId)?.task;
    const taskState = String(activeTask?.interaction?.state || activeTask?.state || '').toLowerCase().replace(/[-_ ]/g, '');
    if (activeTask && wrapup && !wrapupSubmitted && (taskState === 'wrapup' || isWrappingUp(activeId))) {
      wrapupSubmitted = true;
      onStatus('Completing wrap-up for the transferred call…');
      try {
        const result = await wrapup(activeId);
        if (![result?.type, result?.data?.type].includes('AgentWrappedUp')) {
          throw new Error('Webex did not confirm wrap-up.');
        }
      } catch (error) {
        throw new Error(`Call transferred, but automatic wrap-up failed: ${error.message} Complete wrap-up in Agent Desktop; the picked call was not claimed.`);
      }
      onStatus('Wrap-up confirmed. Waiting for voice capacity to clear…');
      // Read a fresh task map before claiming, even when wrap-up returns success.
      await wait();
      continue;
    }
    if (remaining.length === 0) {
      try { await checkPicked(); }
      catch (error) { throw new Error(`The first call was transferred, but the picked call could not be claimed: ${error.message}`); }
      if (!isConnected()) throw new Error('Call transferred; widget closed before claiming the picked call.');
      // Recheck after the remote picked-call check, since another offer can arrive meanwhile.
      if (voiceTasks(await getTasks()).length) throw new Error('Call transferred, but your voice capacity changed. The picked call was not claimed.');
      onStatus('Claiming the picked call…');
      try { return await claim(pickedId); }
      catch (error) { throw new Error(`The first call was transferred, but Claim failed: ${error.message}`); }
    }
    await wait();
  }
  throw new Error('Call transferred, but your voice task did not clear within 90 seconds. Complete wrap-up and claim a call manually.');
}
