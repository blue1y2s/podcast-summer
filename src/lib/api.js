async function parseApiResponse(response, fallbackMessage) {
  let payload = null;

  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(payload?.error || fallbackMessage || `HTTP error! status: ${response.status}`);
  }

  return payload;
}

export async function uploadLocalAudioFile(audioFile, sessionId) {
  const uploadData = new FormData();
  uploadData.append('audioFile', audioFile);
  uploadData.append('sessionId', sessionId);

  const response = await fetch('/api/upload-audio', {
    method: 'POST',
    body: uploadData
  });

  const result = await parseApiResponse(response, 'Audio upload failed');
  if (!result.success) {
    throw new Error(result.error || 'Audio upload failed');
  }

  return result.data;
}

export async function estimateRemoteDuration(url) {
  const response = await fetch('/api/estimate-duration', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    return null;
  }

  const result = await response.json();
  return result.success ? result.estimatedDuration : null;
}

export async function processRemoteAudio(payload) {
  const response = await fetch('/api/process-podcast', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return parseApiResponse(response, 'Remote audio processing failed');
}

export async function processLocalAudio(payload) {
  const response = await fetch('/api/process-local-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return parseApiResponse(response, 'Local audio processing failed');
}

export async function fetchLatestResult() {
  const response = await fetch('/api/latest-result');

  if (!response.ok) {
    return null;
  }

  const result = await response.json();
  return result.success
    ? {
        ...result.data,
        updatedAt: result.updatedAt || result.data?.updatedAt || null
      }
    : null;
}

export async function fetchHistory() {
  const response = await fetch('/api/history');

  if (!response.ok) {
    return [];
  }

  const result = await response.json();
  return result.success ? result.items || [] : [];
}

export async function fetchHistoryResult(historyId) {
  const response = await fetch(`/api/history/${encodeURIComponent(historyId)}`);

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(result.error || 'History record not found');
  }

  return {
    ...result.data,
    updatedAt: result.updatedAt || result.data?.updatedAt || null
  };
}

export async function deleteHistoryResult(historyId) {
  const response = await fetch(`/api/history/${encodeURIComponent(historyId)}`, {
    method: 'DELETE'
  });

  const result = await parseApiResponse(response, 'History delete failed');
  if (!result.success) {
    throw new Error(result.error || 'History delete failed');
  }

  return result;
}
