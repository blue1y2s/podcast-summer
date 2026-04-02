const LANGUAGE_KEY = 'podcast-transcriber-language';

export function detectBrowserLanguage() {
  const savedLang = window.localStorage.getItem(LANGUAGE_KEY);
  if (savedLang === 'zh' || savedLang === 'en') {
    return savedLang;
  }

  const browserLang = navigator.language || navigator.userLanguage || 'en';
  return browserLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

export function persistLanguage(language) {
  window.localStorage.setItem(LANGUAGE_KEY, language);
}

export function generateSessionId() {
  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function validatePodcastUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

export function formatDurationLabel(seconds) {
  if (!seconds || Number.isNaN(seconds)) {
    return null;
  }

  const totalSeconds = Math.round(Number(seconds));
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}

export function formatElapsedLabel(seconds) {
  if (!seconds && seconds !== 0) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.round(Number(seconds)));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${remainingSeconds}s`;
}

export function estimateDurationFromFileSize(bytes) {
  if (!bytes) {
    return null;
  }

  return Math.max(120, Math.round(bytes / 16384));
}

export function formatFileSize(bytes) {
  if (!bytes && bytes !== 0) {
    return '';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function escapeHtml(input) {
  return String(input)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

export function formatDateTimeLabel(input, locale = 'zh-CN') {
  if (!input) {
    return '';
  }

  const value = new Date(input);
  if (Number.isNaN(value.getTime())) {
    return '';
  }

  const now = new Date();
  const isSameYear = value.getFullYear() === now.getFullYear();

  return new Intl.DateTimeFormat(locale, {
    ...(isSameYear ? {} : { year: 'numeric' }),
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(value);
}

export function looksLikeOpaqueTitle(input) {
  const value = String(input || '').trim();
  if (!value) {
    return false;
  }

  return /^[a-f0-9]{16,}$/i.test(value) || /^[A-Z0-9_-]{24,}$/i.test(value);
}

export function getDisplayResultTitle(input, fallbackText) {
  const value = String(input || '').trim();
  if (!value || looksLikeOpaqueTitle(value)) {
    return fallbackText;
  }

  return value;
}

export function formatHistoryTimestamp(timestamp, locale = 'en-US') {
  if (!timestamp) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp));
  } catch (_error) {
    return '';
  }
}

export function getPreferredTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'studio-dark' : 'studio';
}

export function normalizeErrorMessage(error, fallbackText) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error) {
    return error;
  }

  return fallbackText;
}
