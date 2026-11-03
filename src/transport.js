export async function postJson(url, body, token, fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: controller.signal, credentials: 'omit'
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  } finally { clearTimeout(timeout); }
}

// Unresolved metadata is deliberately not cached, so a late flow webhook is retried.
export function mergeCallerIds(cache, rows) {
  for (const row of rows) if (row.found === true) cache[row.InteractionId] = row;
}

// Assignment can return an empty 202 response; acceptance is not call delivery.
export async function assignVoiceTask(apiBase, taskId, token, fetcher = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetcher(`${apiBase.replace(/\/$/, '')}/v1/tasks/${encodeURIComponent(taskId)}/assign`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    const raw = await response.text();
    if (!response.ok) {
      let detail = raw;
      try {
        const payload = JSON.parse(raw);
        detail = payload.message || payload.error?.message || payload.error || payload.errors || payload;
        if (typeof detail !== 'string') detail = JSON.stringify(detail);
      } catch (_) { /* Non-JSON error bodies are displayed as text. */ }
      const tracking = response.headers.get('trackingid') || response.headers.get('x-request-id');
      throw new Error(`Claim failed (HTTP ${response.status})${detail ? ': ' + detail.slice(0, 700) : ''}${tracking ? ' — Reference: ' + tracking : ''}`);
    }
    return { status: response.status };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Claim request timed out. Check whether the call was delivered before retrying.');
    if (error instanceof TypeError) throw new Error('Claim could not reach Webex. Check the browser Network panel for a blocked or failed /assign request.');
    throw error;
  } finally { clearTimeout(timeout); }
}
