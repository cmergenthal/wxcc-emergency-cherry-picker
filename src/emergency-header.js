import { voiceTasks, withDeadline, transferThenClaim, configuredTransferWrapup } from './queue-transfer.js';
import { acceptClaimedWebRtcCall } from './webrtc.js';

export function newestEmergency(rows, { queueName = 'cmergentEmergency', queueId = '' } = {}) {
  return rows.filter(row => {
    const task = row.attributes || {};
    const media = task.channelType || task.mediaType;
    return row.id && ['queued', 'created'].includes(task.status) &&
      (!media || ['telephony', 'voice'].includes(String(media).toLowerCase())) &&
      (queueId ? String(task.queue?.id || task.queueId || '') === queueId : task.queue?.name === queueName) &&
      Number.isFinite(Number(task.createdTime));
  }).sort((a, b) => Number(b.attributes.createdTime) - Number(a.attributes.createdTime) || String(a.id).localeCompare(String(b.id)))[0] || null;
}

export function transferDestination(task, settings) {
  if (settings.emergencyTransferQueueId) return String(settings.emergencyTransferQueueId);
  if (settings.emergencyTransferMode !== 'original') throw new Error('Configure the existing call’s destination queue before answering.');
  const interaction = task.interaction || {};
  const details = interaction.callProcessingDetails || {};
  const id = interaction.currentVTeam || details.QueueId || details.queueId || details.vteamId || task.queue?.id;
  if (!id) throw new Error('The existing call has no original queue ID. Configure emergencyTransferQueueId.');
  return String(id);
}

// Keep enumeration within the authenticated API origin; never forward a token to a next-link host.
export async function listEmergencyTasks({ apiBase, token, from, to = Date.now(), fetcher = fetch, signal, onPage = () => {} }) {
  const first = new URL(`${apiBase.replace(/\/$/, '')}/v1/tasks`);
  first.searchParams.set('from', String(from));
  first.searchParams.set('to', String(to));
  first.searchParams.set('channelTypes', 'telephony');
  first.searchParams.set('pageSize', '1000');
  let url = first;
  const seen = new Set();
  const rows = new Map();
  for (let page = 0; url && page < 100; page++) {
    if (url.origin !== first.origin || url.pathname !== first.pathname || seen.has(url.href)) throw new Error('Invalid task pagination link.');
    seen.add(url.href);
    const response = await fetcher(url.href, { headers: { Authorization: `Bearer ${token}` }, signal });
    if (!response.ok) throw new Error(`Emergency queue lookup failed (HTTP ${response.status}).`);
    const payload = await response.json();
    if (!Array.isArray(payload.data)) throw new Error('Webex returned an invalid task list.');
    for (const row of payload.data) rows.set(row.id, row);
    onPage({ count: payload.data.length, from: Number(url.searchParams.get('from')), to, status: response.status || 200 });
    const link = response.headers?.get('link')?.match(/<([^>]+)>;\s*rel="?next"?/i)?.[1];
    const next = payload.meta?.links?.next || payload.links?.next || link;
    if (next) {
      url = new URL(next, url);
      for (const name of ['to', 'from', 'channelTypes', 'pageSize']) {
        if (!url.searchParams.has(name)) url.searchParams.set(name, first.searchParams.get(name));
      }
    } else {
      const pageSize = Number(url.searchParams.get('pageSize')) || 1000;
      if (payload.data.length < pageSize) { url = null; continue; }
      // The API returns oldest first. A full page without an accessible next
      // link is not complete. Advance the documented created-time window,
      // overlapping its final timestamp to avoid losing tied records.
      const times = payload.data.map(row => Number(row.attributes?.createdTime));
      if (times.some(time => !Number.isFinite(time))) throw new Error('Task page is full but creation times are missing; queue results are incomplete.');
      const nextFrom = Math.max(...times) - 1;
      const previousFrom = Number(url.searchParams.get('from'));
      if (nextFrom <= previousFrom) throw new Error('Task page cannot advance past tied creation times; queue results are incomplete.');
      url = new URL(first);
      url.searchParams.set('from', String(nextFrom));
    }
  }
  if (url) throw new Error('Emergency queue lookup exceeded the page limit; results are incomplete.');
  return [...rows.values()];
}

export function emergencyDiagnostics(rows, settings, pages = []) {
  const counts = new Map();
  let waiting = 0;
  for (const { attributes: task = {} } of rows) {
    const queue = task.queue?.name || '(queue name missing)';
    const key = `${queue} | ${task.status || '(status missing)'}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (['queued', 'created'].includes(task.status)) waiting++;
  }
  const targetRows = rows.filter(row => settings.queueId
    ? String(row.attributes?.queue?.id || row.attributes?.queueId || '') === settings.queueId
    : row.attributes?.queue?.name === settings.queueName);
  return {
    build: 'emergency-header-2', checkedAt: new Date().toISOString(), apiOrigin: new URL(settings.wxccApiBaseUrl).origin,
    targetQueueName: settings.queueName, matchesBy: settings.queueId ? 'queue ID' : 'queue name',
    taskCount: rows.length, waitingTaskCount: waiting, targetQueueTaskCount: targetRows.length,
    targetStatuses: [...new Set(targetRows.map(row => row.attributes?.status))], pages,
    queueSummary: [...counts].map(([queueAndStatus, count]) => ({ queueAndStatus, count })).sort((a, b) => a.queueAndStatus.localeCompare(b.queueAndStatus)),
    // Aggregate queue names and statuses only: no caller identifiers or tokens.
  };
}

export async function answerPickedOffer({ desktop, taskId, hasOffer = () => false, isConnected = () => true,
  wait = () => new Promise(resolve => setTimeout(resolve, 250)), maxChecks = 80 }) {
  for (let attempt = 0; attempt < maxChecks; attempt++) {
    if (!isConnected()) throw new Error('Widget closed. Check the picked call in Agent Desktop.');
    const tasks = voiceTasks(await withDeadline(() => desktop.actions.getTaskMap(), 5000, 'Agent task lookup timed out.'));
    if (tasks.some(task => task.id !== taskId)) throw new Error('Another voice call arrived. The emergency call was not answered automatically.');
    const picked = tasks.find(task => task.id === taskId)?.task;
    const state = String(picked?.state || picked?.interaction?.state || '').toLowerCase();
    if (picked && (/wrap|ended|completed/.test(state))) throw new Error('The emergency call has already ended.');
    // Require the target task plus its offer, not just an interaction which may
    // already be globally connected while its agent leg is still ringing.
    if (picked && (hasOffer(taskId) || /offered|ringing|alerting/.test(state))) {
      await withDeadline(() => acceptClaimedWebRtcCall(desktop.actions, taskId), 5000, 'Browser answer request timed out.');
      return;
    }
    await wait();
  }
  throw new Error('The emergency call was claimed, but no matching browser offer arrived. Check Agent Desktop or use Accept.');
}

export async function takeEmergency({ desktop, settings, picked, getRows, claim, hasOffer, isWrappingUp,
  onStatus = () => {}, isConnected = () => true }) {
  const getTasks = () => withDeadline(() => desktop.actions.getTaskMap(), 10000, 'Agent task lookup timed out.');
  const checkPicked = async () => {
    const row = (await getRows()).find(row => row.id === picked.id);
    if (!newestEmergency(row ? [row] : [], settings)) throw new Error('This emergency contact is no longer waiting in the emergency queue.');
  };
  const active = voiceTasks(await getTasks());
  if (active.length > 1) throw new Error('Multiple voice tasks are present. Review them in Agent Desktop.');
  if (active.length) {
    const queueId = transferDestination(active[0].task, settings);
    if (queueId === String(picked.attributes.queue?.id || settings.queueId)) throw new Error('Choose a destination other than the emergency queue for the existing call.');
    // One-click mode requires explicit wrap-up configuration before transfer.
    const wrapup = configuredTransferWrapup(desktop, { ...settings, autoWrapUpOnTransfer: true });
    await transferThenClaim({ activeId: active[0].id, pickedId: picked.id, queueId, getTasks,
      transfer: (id, destination) => withDeadline(() => desktop.agentContact.vteamTransferV2({
        interactionId: id, data: { to: destination, destinationType: 'queue' }
      }), 30000, 'Transfer confirmation timed out. Check the current call before retrying.'),
      wrapup, isWrappingUp, checkPicked, claim, onStatus, isConnected });
  } else {
    await checkPicked();
    if (!isConnected() || voiceTasks(await getTasks()).length) throw new Error('Voice capacity changed. Review Agent Desktop before answering.');
    onStatus('Claiming emergency call…');
    await claim(picked.id);
  }
  onStatus('Waiting for the emergency call offer…');
  await answerPickedOffer({ desktop, taskId: picked.id, hasOffer, isConnected });
  onStatus('Answer requested. Confirm audio in Agent Desktop.');
}
