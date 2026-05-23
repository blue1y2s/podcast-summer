const isStaticDemo = typeof window !== 'undefined' && (window.location.hostname.endsWith('github.io') || window.location.search.includes('mode=demo'));

const MOCK_RESULT_DATA = {
  podcastTitle: "Demo Podcast Episode",
  estimatedDuration: 300,
  actualDuration: 300,
  transcript: `[00:00] Speaker A: Welcome to the Podcast Summer demo! Today we are discussing building useful and clean web applications.
[00:30] Speaker B: Absolutely. Simplicity and great UI design are the keys to a successful product.
[01:00] Speaker A: Exactly. We want to show how AI can process and summarize long audio content.
[02:00] Speaker B: Let's make sure the demo works fully on static platforms like GitHub Pages.`,
  summary: `### Episode Summary
In this demo episode, Speaker A and Speaker B discuss the principles of building clean, useful web applications. They emphasize the importance of simplicity and excellent user interface design, and demonstrate how AI can process and summarize audio content.

### Key Takeaways
- **Simplicity**: Focus on core features and keep the interface intuitive.
- **Visual Design**: Premium styling and smooth transitions enhance engagement.
- **Client-Side Fallback**: Local storage allows the app to function fully in static environments without backend dependencies.`,
  translation: `[00:00] 说话者 A: 欢迎来到 Podcast Summer 演示！今天我们讨论的是构建有用且干净的 Web 应用程序。
[00:30] 说话者 B: 当然。简单和出色的 UI 设计是成功产品的关键。
[01:00] 说话者 A: 没错。我们想展示 AI 如何处理和总结长音频内容。
[02:00] 说话者 B: 让我们确保该演示在 GitHub Pages 等静态平台上能够完全正常运行。`,
  savedFiles: [
    { type: "transcript", filename: "demo_transcript.md", size: 1024, path: "demo_transcript.md" },
    { type: "summary", filename: "demo_summary.md", size: 512, path: "demo_summary.md" },
    { type: "translation", filename: "demo_translation.md", size: 1024, path: "demo_translation.md" }
  ]
};

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
  if (isStaticDemo) {
    return {
      filename: audioFile.name,
      originalName: audioFile.name,
      size: audioFile.size,
      mimeType: audioFile.type
    };
  }

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
  if (isStaticDemo) {
    return 300;
  }

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
  if (isStaticDemo) {
    await new Promise(resolve => setTimeout(resolve, 2500));

    const historyId = `history-${Date.now()}`;
    const updatedAt = new Date().toISOString();
    const podcastTitle = payload.url ? (payload.url.includes('xiaoyuzhou.com') ? "小宇宙播客 - 探索人工智能新纪元" : "Demo Podcast from Link") : "Demo Podcast Episode";

    const resultData = {
      ...MOCK_RESULT_DATA,
      podcastTitle,
      historyId,
      sourceMode: 'url',
      sourceUrl: payload.url || ''
    };

    const snapshotPayload = {
      id: historyId,
      updatedAt,
      data: resultData
    };

    localStorage.setItem('podcast_latest_result', JSON.stringify(snapshotPayload));
    localStorage.setItem(`podcast_history_detail_${historyId}`, JSON.stringify(snapshotPayload));

    const indexRaw = localStorage.getItem('podcast_history_index');
    let items = [];
    if (indexRaw) {
      try {
        items = JSON.parse(indexRaw);
      } catch (e) {}
    }
    const newItem = {
      id: historyId,
      title: podcastTitle,
      sourceMode: 'url',
      actualDuration: 300,
      estimatedDuration: 300,
      updatedAt
    };
    localStorage.setItem('podcast_history_index', JSON.stringify([newItem, ...items]));

    return {
      success: true,
      data: resultData
    };
  }

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
  if (isStaticDemo) {
    await new Promise(resolve => setTimeout(resolve, 2500));

    const historyId = `history-${Date.now()}`;
    const updatedAt = new Date().toISOString();
    const podcastTitle = payload.originalName ? payload.originalName.replace(/\.[^/.]+$/, "") : "Demo Local Audio";

    const resultData = {
      ...MOCK_RESULT_DATA,
      podcastTitle,
      historyId,
      sourceMode: 'file',
      sourceFilename: payload.originalName || ''
    };

    const snapshotPayload = {
      id: historyId,
      updatedAt,
      data: resultData
    };

    localStorage.setItem('podcast_latest_result', JSON.stringify(snapshotPayload));
    localStorage.setItem(`podcast_history_detail_${historyId}`, JSON.stringify(snapshotPayload));

    const indexRaw = localStorage.getItem('podcast_history_index');
    let items = [];
    if (indexRaw) {
      try {
        items = JSON.parse(indexRaw);
      } catch (e) {}
    }
    const newItem = {
      id: historyId,
      title: podcastTitle,
      sourceMode: 'file',
      actualDuration: 300,
      estimatedDuration: 300,
      updatedAt
    };
    localStorage.setItem('podcast_history_index', JSON.stringify([newItem, ...items]));

    return {
      success: true,
      data: resultData
    };
  }

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
  if (isStaticDemo) {
    const raw = localStorage.getItem('podcast_latest_result');
    if (!raw) return null;
    try {
      const payload = JSON.parse(raw);
      return {
        ...payload.data,
        updatedAt: payload.updatedAt || payload.data?.updatedAt || null
      };
    } catch (e) {
      return null;
    }
  }

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
  if (isStaticDemo) {
    const raw = localStorage.getItem('podcast_history_index');
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch (e) {
      return [];
    }
  }

  const response = await fetch('/api/history');

  if (!response.ok) {
    return [];
  }

  const result = await response.json();
  return result.success ? result.items || [] : [];
}

export async function fetchHistoryResult(historyId) {
  if (isStaticDemo) {
    const raw = localStorage.getItem(`podcast_history_detail_${historyId}`);
    if (!raw) {
      throw new Error('History record not found');
    }
    try {
      const payload = JSON.parse(raw);
      return {
        ...payload.data,
        updatedAt: payload.updatedAt || payload.data?.updatedAt || null
      };
    } catch (e) {
      throw new Error('Failed to parse history data');
    }
  }

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
  if (isStaticDemo) {
    localStorage.removeItem(`podcast_history_detail_${historyId}`);
    const indexRaw = localStorage.getItem('podcast_history_index');
    let items = [];
    if (indexRaw) {
      try {
        items = JSON.parse(indexRaw);
      } catch (e) {}
    }
    const nextItems = items.filter(item => item.id !== historyId);
    localStorage.setItem('podcast_history_index', JSON.stringify(nextItems));

    const latestRaw = localStorage.getItem('podcast_latest_result');
    let nextHistoryId = null;
    if (latestRaw) {
      try {
        const latest = JSON.parse(latestRaw);
        if (latest.id === historyId || latest.data?.historyId === historyId) {
          localStorage.removeItem('podcast_latest_result');
          if (nextItems.length > 0) {
            nextHistoryId = nextItems[0].id;
            const nextDetailRaw = localStorage.getItem(`podcast_history_detail_${nextHistoryId}`);
            if (nextDetailRaw) {
              localStorage.setItem('podcast_latest_result', nextDetailRaw);
            }
          }
        }
      } catch (e) {}
    }

    return {
      success: true,
      deletedFileCount: 0,
      nextHistoryId
    };
  }

  const response = await fetch(`/api/history/${encodeURIComponent(historyId)}`, {
    method: 'DELETE'
  });

  const result = await parseApiResponse(response, 'History delete failed');
  if (!result.success) {
    throw new Error(result.error || 'History delete failed');
  }

  return result;
}
