// The SDK answers the current browser offer, not an arbitrary task ID.
export async function acceptClaimedWebRtcCall(actions, taskId) {
  if (!taskId) throw new Error('Claim a call first.');
  if (typeof actions.acceptWebRtcCall !== 'function') throw new Error('This Desktop SDK does not expose WebRTC Accept. Reload the updated widget.');
  const tasks = await actions.getTaskMap();
  if (!tasks || typeof tasks.entries !== 'function') throw new Error('Agent Desktop task information is unavailable.');
  const voiceTasks = [...tasks.entries()].filter(([, task]) => {
    const media = task.interaction?.mediaType || task.interaction?.mediaChannel || task.mediaType;
    return !media || media === 'telephony' || media === 'voice';
  });
  if (voiceTasks.length !== 1 || !voiceTasks.some(([id, task]) => [id, task.interactionId, task.interaction?.interactionId].includes(taskId))) {
    throw new Error('The claimed call is not the single current voice task in Agent Desktop. Wait for its offer, then retry.');
  }
  await actions.acceptWebRtcCall();
  // SDK 3.0.1 dispatches ax-web-call-answer and returns void. Never call this connected.
}
