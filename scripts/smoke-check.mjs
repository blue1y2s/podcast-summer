import { spawn } from 'node:child_process';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT_BASE = 3100;
const PORT_CANDIDATES = [PORT_BASE, PORT_BASE + 1, PORT_BASE + 2];
const SERVER_START_TIMEOUT_MS = 20000;
const REQUEST_TIMEOUT_MS = 5000;

function log(message) {
  process.stdout.write(`${message}\n`);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      cache: 'no-store',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForHealthyBaseUrl() {
  const startedAt = Date.now();

  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    for (const port of PORT_CANDIDATES) {
      const candidate = `http://127.0.0.1:${port}`;

      try {
        const response = await fetchWithTimeout(`${candidate}/api/health`);
        if (response.ok) {
          return candidate;
        }
      } catch (_error) {
        // Keep polling until a candidate becomes healthy.
      }
    }

    await delay(250);
  }

  throw new Error('Timed out while waiting for the server to become healthy.');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function verifyServer(baseUrl) {
  const healthResponse = await fetchWithTimeout(`${baseUrl}/api/health`);
  assert(healthResponse.ok, '/api/health must respond with HTTP 200.');

  const healthPayload = await healthResponse.json();
  assert(healthPayload?.status === 'ok', '/api/health must return { status: "ok" }.');

  const rootResponse = await fetchWithTimeout(`${baseUrl}/`);
  assert(rootResponse.ok, '/ must respond with HTTP 200.');
  const rootBody = await rootResponse.text();
  assert(rootBody.toLowerCase().includes('<!doctype html>'), '/ must return an HTML document.');

  const historyResponse = await fetchWithTimeout(`${baseUrl}/api/history`);
  assert(historyResponse.ok, '/api/history must respond with HTTP 200.');
  const historyPayload = await historyResponse.json();
  assert(historyPayload?.success === true, '/api/history must return success: true.');
  assert(Array.isArray(historyPayload.items), '/api/history must return an items array.');

  const latestResponse = await fetchWithTimeout(`${baseUrl}/api/latest-result`);
  assert([200, 404].includes(latestResponse.status), '/api/latest-result must return HTTP 200 or 404.');
  const latestPayload = await latestResponse.json();
  assert(typeof latestPayload?.success === 'boolean', '/api/latest-result must return a JSON success flag.');

  if (latestResponse.status === 200) {
    assert(latestPayload.success === true, '/api/latest-result must return success: true on HTTP 200.');
  } else {
    assert(latestPayload.success === false, '/api/latest-result must return success: false on HTTP 404.');
  }
}

async function terminateServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill('SIGINT');

  const waitForExit = new Promise((resolve) => {
    child.once('exit', resolve);
  });

  try {
    await Promise.race([waitForExit, delay(5000)]);
  } catch (_error) {
    // Ignore and fall back to SIGKILL below.
  }

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await waitForExit;
  }
}

async function main() {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(PORT_BASE)
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[server:error] ${chunk}`);
  });

  try {
    const baseUrl = await waitForHealthyBaseUrl();
    log(`Smoke check connected to ${baseUrl}`);
    await verifyServer(baseUrl);
    log('Smoke check passed.');
  } finally {
    await terminateServer(child);
  }
}

main().catch((error) => {
  process.stderr.write(`Smoke check failed: ${error.message}\n`);
  process.exitCode = 1;
});
