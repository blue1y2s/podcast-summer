const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(APP_ROOT, 'server', 'index.js');
const PRELOAD_ENTRY = path.join(__dirname, 'preload.js');
const DESKTOP_PORT = Number(process.env.ELECTRON_PORT) || 3310;
const PORT_CANDIDATES = [DESKTOP_PORT, DESKTOP_PORT + 1, DESKTOP_PORT + 2];
const HAS_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();
const SERVER_READY_TIMEOUT_MS = 45000;
const SERVER_RESTART_BASE_DELAY_MS = 1500;
const SERVER_RESTART_MAX_DELAY_MS = 12000;
const SERVER_HEALTHCHECK_INTERVAL_MS = 10000;
const SERVER_HEALTHCHECK_TIMEOUT_MS = 2500;

let mainWindow = null;
let serverProcess = null;
let serverUrl = null;
let isQuitting = false;
let serverBootPromise = null;
let serverRestartTimer = null;
let serverHealthTimer = null;
let serverHealthcheckInFlight = false;
let serverRestartDelayMs = SERVER_RESTART_BASE_DELAY_MS;

if (!HAS_SINGLE_INSTANCE_LOCK) {
    app.quit();
}

function logServerOutput(prefix, chunk) {
    const text = chunk.toString().trim();
    if (!text) {
        return;
    }

    text.split('\n').forEach((line) => {
        console.log(`[desktop:${prefix}] ${line}`);
    });
}

function startServerProcess() {
    if (serverProcess) {
        return serverProcess;
    }

    const child = spawn(process.execPath, [SERVER_ENTRY], {
        cwd: APP_ROOT,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            PORT: String(DESKTOP_PORT)
        },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    child.expectedExit = false;
    child.stdout.on('data', (chunk) => logServerOutput('server', chunk));
    child.stderr.on('data', (chunk) => logServerOutput('server:error', chunk));
    child.on('error', (error) => {
        console.error('[desktop] backend process error', error);
    });
    child.on('exit', (code, signal) => {
        console.log(`[desktop] backend exited (code=${code}, signal=${signal})`);
        if (serverProcess === child) {
            serverProcess = null;
        }

        if (!child.expectedExit && !isQuitting) {
            scheduleServerRestart(`exit:${code ?? 'null'}:${signal ?? 'none'}`);
        }
    });

    serverProcess = child;
    return child;
}

function clearServerRestartTimer() {
    if (serverRestartTimer) {
        clearTimeout(serverRestartTimer);
        serverRestartTimer = null;
    }
}

async function probeServer(candidate) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SERVER_HEALTHCHECK_TIMEOUT_MS);

    try {
        const response = await fetch(`${candidate}/api/health`, {
            signal: controller.signal,
            cache: 'no-store'
        });

        return response.ok;
    } catch (_error) {
        return false;
    } finally {
        clearTimeout(timeout);
    }
}

function scheduleServerRestart(reason) {
    if (isQuitting || serverRestartTimer) {
        return;
    }

    const delay = serverRestartDelayMs;
    console.warn(`[desktop] scheduling backend restart in ${delay}ms (${reason})`);
    serverRestartTimer = setTimeout(async () => {
        serverRestartTimer = null;

        try {
            await restartServer(reason);
            serverRestartDelayMs = SERVER_RESTART_BASE_DELAY_MS;
        } catch (error) {
            console.error('[desktop] backend restart failed', error);
            serverRestartDelayMs = Math.min(serverRestartDelayMs * 2, SERVER_RESTART_MAX_DELAY_MS);
            scheduleServerRestart('retry-after-failed-restart');
        }
    }, delay);
}

async function ensureWindowConnected(nextUrl) {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    const currentUrl = mainWindow.webContents.getURL();
    if (currentUrl !== nextUrl) {
        await mainWindow.loadURL(nextUrl);
        return;
    }

    mainWindow.webContents.reloadIgnoringCache();
}

async function waitForServerReady(timeoutMs = SERVER_READY_TIMEOUT_MS) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        for (const port of PORT_CANDIDATES) {
            const candidate = `http://127.0.0.1:${port}`;

            try {
                const healthy = await probeServer(candidate);
                if (healthy) {
                    return candidate;
                }
            } catch (error) {
                // Keep polling until one of the candidate ports becomes healthy.
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('桌面应用后端启动超时');
}

async function ensureServerReady(reason = 'startup') {
    if (serverBootPromise) {
        return serverBootPromise;
    }

    serverBootPromise = (async () => {
        clearServerRestartTimer();
        startServerProcess();
        const nextUrl = await waitForServerReady();
        const urlChanged = serverUrl !== nextUrl;
        serverUrl = nextUrl;
        serverRestartDelayMs = SERVER_RESTART_BASE_DELAY_MS;

        if (reason !== 'startup' && (urlChanged || (mainWindow && !mainWindow.isDestroyed()))) {
            await ensureWindowConnected(serverUrl);
        }

        return serverUrl;
    })().finally(() => {
        serverBootPromise = null;
    });

    return serverBootPromise;
}

function startServerHealthMonitor() {
    if (serverHealthTimer) {
        clearInterval(serverHealthTimer);
    }

    serverHealthTimer = setInterval(async () => {
        if (isQuitting || serverHealthcheckInFlight || !serverUrl) {
            return;
        }

        serverHealthcheckInFlight = true;
        try {
            const healthy = await probeServer(serverUrl);
            if (!healthy) {
                console.warn('[desktop] backend healthcheck failed, restarting');
                await restartServer('healthcheck');
            }
        } catch (error) {
            console.error('[desktop] backend healthcheck error', error);
            scheduleServerRestart('healthcheck-error');
        } finally {
            serverHealthcheckInFlight = false;
        }
    }, SERVER_HEALTHCHECK_INTERVAL_MS);
}

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1480,
        height: 980,
        minWidth: 1180,
        minHeight: 760,
        backgroundColor: '#e8efe9',
        titleBarStyle: 'hiddenInset',
        autoHideMenuBar: true,
        webPreferences: {
            preload: PRELOAD_ENTRY,
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    await mainWindow.loadURL(serverUrl);
}

function stopServerProcess() {
    if (!serverProcess) {
        return;
    }

    const processToStop = serverProcess;
    serverProcess = null;
    processToStop.expectedExit = true;

    processToStop.kill('SIGTERM');

    setTimeout(() => {
        if (processToStop.exitCode === null && processToStop.signalCode === null) {
            processToStop.kill('SIGKILL');
        }
    }, 3000);
}

async function restartServer(reason = 'manual') {
    if (isQuitting) {
        return;
    }

    console.log(`[desktop] restarting backend (${reason})`);
    stopServerProcess();
    await ensureServerReady(reason);
}

ipcMain.handle('desktop:get-state', () => ({
    isDesktop: true,
    platform: process.platform,
    isMaximized: mainWindow ? mainWindow.isMaximized() : false,
    serverUrl,
    tempDir: path.join(APP_ROOT, 'server', 'temp'),
    resultsRoot: path.join(APP_ROOT, 'results', 'transcriptions')
}));

ipcMain.handle('desktop:reveal-path', async (_event, targetPath) => {
    if (!targetPath || typeof targetPath !== 'string') {
        return { ok: false, error: 'missing-path' };
    }

    if (!fs.existsSync(targetPath)) {
        return { ok: false, error: 'not-found' };
    }

    const stats = fs.statSync(targetPath);
    if (stats.isFile()) {
        shell.showItemInFolder(targetPath);
        return { ok: true };
    }

    const error = await shell.openPath(targetPath);
    return error ? { ok: false, error } : { ok: true };
});

ipcMain.handle('desktop:toggle-maximize', (event) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;

    if (!targetWindow || targetWindow.isDestroyed()) {
        return { ok: false, error: 'window-not-found', isMaximized: false };
    }

    if (targetWindow.isMaximized()) {
        targetWindow.unmaximize();
    } else {
        targetWindow.maximize();
    }

    return { ok: true, isMaximized: targetWindow.isMaximized() };
});

app.whenReady().then(async () => {
    if (!HAS_SINGLE_INSTANCE_LOCK) {
        return;
    }

    serverUrl = await ensureServerReady('startup');
    await createWindow();
    startServerHealthMonitor();

    app.on('second-instance', async () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
            return;
        }

        await createWindow();
    });

    app.on('activate', async () => {
        if (!mainWindow || mainWindow.isDestroyed() || BrowserWindow.getAllWindows().length === 0) {
            await createWindow();
        }
    });
}).catch((error) => {
    console.error('[desktop] failed to start', error);
    app.quit();
});

app.on('before-quit', () => {
    isQuitting = true;
    clearServerRestartTimer();
    if (serverHealthTimer) {
        clearInterval(serverHealthTimer);
        serverHealthTimer = null;
    }
    stopServerProcess();
});

app.on('quit', () => {
    isQuitting = true;
    stopServerProcess();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
