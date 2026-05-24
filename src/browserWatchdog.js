/**
 * browserWatchdog.js
 * ==================
 * Menjaga CloakBrowser tetap hidup.
 *
 * Skip otomatis jika:
 *   - SKIP_BROWSER=true di .env
 *   - Berjalan di Linux/WSL tanpa powershell.exe (CloakBrowser Windows-only)
 *
 * Untuk WSL: set CLOAK_CDP_URL=http://HOST_IP:9222 jika browser sudah jalan di Windows.
 */

'use strict';

const net            = require('net');
const { exec }       = require('child_process');
const path           = require('path');
const fs             = require('fs');
const { execSync }   = require('child_process');

function getHostIP() {
    if (process.platform === 'linux') {
        try {
            const ip = execSync("ip route | grep default | awk '{print $3}'", { stdio: ['pipe','pipe','pipe'] }).toString().trim();
            if (ip) return ip;
        } catch (_) {}
        return '172.24.48.1';
    }
    return '127.0.0.1';
}

const HOST_IP = getHostIP();

const CHROME_PATH  = String(process.env.CLOAK_CHROME_PATH || '/mnt/c/Users/user/.antigravity/Nexus-DualBrain-AI/bin/cloak/chrome.exe');
const PROFILE_DIR  = String(process.env.CLOAK_PROFILE_DIR || 'C:\\Users\\user\\.antigravity\\Nexus-DualBrain-AI\\bin\\cloak_profile');
const DEBUG_PORT   = Number(process.env.CLOAK_DEBUG_PORT || 9223);
const CHECK_INTERVAL_MS   = 5_000;
const RESTART_COOLDOWN_MS = 8_000;

let _watcherTimer    = null;
let _lastRestartTime = 0;
let _restartCount    = 0;
let _isRestarting    = false;
let _browserAvailable = false;

/** Deteksi apakah browser mode tersedia di sistem ini */
function detectBrowserSupport() {
    if (process.env.SKIP_BROWSER === 'true') {
        console.log('[BrowserWatchdog] SKIP_BROWSER=true — mode tanpa browser diaktifkan.');
        return false;
    }
    if (process.platform === 'linux') {
        // Cek apakah CloakBrowser tersedia via path WSL langsung
        try {
            if (fs.existsSync(CHROME_PATH)) {
                console.log(`[BrowserWatchdog] ✅ CloakBrowser ditemukan di: ${CHROME_PATH}`);
                return true;
            }
        } catch (_) {}
        console.log('[BrowserWatchdog] ⚠ CloakBrowser tidak ditemukan di path WSL.');
        console.log('[BrowserWatchdog] Mode tanpa browser — agent tetap berjalan via teks.');
        console.log('[BrowserWatchdog] Tip: Pastikan path benar atau set CLOAK_CHROME_PATH di .env');
        console.log(`[BrowserWatchdog]   CLOAK_CDP_URL=http://${HOST_IP}:${DEBUG_PORT}`);
        return false;
    }
    return true; // Windows native — ok
}

function isPortActive(port = DEBUG_PORT) {
    return new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(1000);
        sock
            .once('connect', () => { sock.destroy(); resolve(true); })
            .once('timeout',  () => { sock.destroy(); resolve(false); })
            .once('error',    () => { sock.destroy(); resolve(false); })
            .connect(port, HOST_IP);
    });
}

function clearLockFiles() {
    const locks = ['LOCK', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    let targetDir = PROFILE_DIR;
    if (process.platform === 'linux' && targetDir.startsWith('C:\\')) {
        targetDir = '/mnt/c/' + targetDir.substring(3).replace(/\\/g, '/');
    }
    for (const f of locks) {
        const p = path.join(targetDir, f);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    }
}

function killCloakProcesses() {
    const cmd = process.platform === 'linux' ? 'taskkill.exe' : 'taskkill';
    return new Promise(resolve => exec(`${cmd} /F /IM chrome.exe`, () => resolve()));
}

function launchDetached() {
    // Di Linux/WSL: jalankan langsung via path WSL (/mnt/c/...)
    // Di Windows native: jalankan via PowerShell
    if (process.platform === 'linux') {
        const command = [
            `"${CHROME_PATH}"`,
            `--user-data-dir="${PROFILE_DIR}"`,
            `--remote-debugging-port=${DEBUG_PORT}`,
            `--remote-allow-origins=*`,
            `--disable-blink-features=AutomationControlled`,
            `--no-sandbox`,
            `--start-maximized`,
        ].join(' ');

        return new Promise((resolve, reject) => {
            // Kill proses chrome lama dulu, lalu launch browser baru di background
            exec(`taskkill.exe /F /IM chrome.exe 2>/dev/null; ${command} &`, (err, stdout, stderr) => {
                // err bisa non-null karena taskkill.exe mungkin tidak ada — abaikan
                console.log(`[BrowserWatchdog] Launch output: ${stdout.trim() || '(detached)'}`);
                if (stderr && !stderr.includes('taskkill') && !stderr.includes('not found')) {
                    console.warn(`[BrowserWatchdog] Launch stderr: ${stderr.trim()}`);
                }
                resolve(stdout.trim());
            });
        });
    }

    // Windows native — pakai PowerShell
    const command = [
        `"${CHROME_PATH}"`,
        `--user-data-dir="${PROFILE_DIR}"`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--remote-allow-origins=*`,
        `--disable-blink-features=AutomationControlled`,
        `--no-sandbox`,
        `--start-maximized`,
    ].join(' ');

    const ps  = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${command}'}`;
    return new Promise((resolve, reject) => {
        exec(`powershell -Command "${ps}"`, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout.trim());
        });
    });
}

async function restartBrowser() {
    if (!_browserAvailable || _isRestarting) return;
    const now = Date.now();
    if (now - _lastRestartTime < RESTART_COOLDOWN_MS) return;

    _isRestarting    = true;
    _lastRestartTime = now;
    _restartCount   += 1;

    console.log(`[BrowserWatchdog] Browser mati — restart #${_restartCount}...`);
    try {
        await killCloakProcesses();
        clearLockFiles();
        await launchDetached();
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1000));
            if (await isPortActive()) {
                console.log(`[BrowserWatchdog] CloakBrowser aktif di port ${DEBUG_PORT}.`);
                break;
            }
        }
    } catch (err) {
        console.error(`[BrowserWatchdog] Gagal restart: ${err.message}`);
    } finally {
        _isRestarting = false;
    }
}

async function start() {
    _browserAvailable = detectBrowserSupport();

    if (!_browserAvailable) {
        // Cek apakah browser sudah jalan via env CLOAK_CDP_URL
        const externalCDP = process.env.CLOAK_CDP_URL;
        if (externalCDP) {
            console.log(`[BrowserWatchdog] Menggunakan browser eksternal: ${externalCDP}`);
        }
        return; // Lanjut tanpa browser — tidak blocking
    }

    console.log(`[BrowserWatchdog] Memulai watchdog CloakBrowser (port ${DEBUG_PORT})...`);
    if (!(await isPortActive())) {
        await restartBrowser();
    } else {
        console.log(`[BrowserWatchdog] CloakBrowser sudah aktif di port ${DEBUG_PORT}.`);
    }

    _watcherTimer = setInterval(async () => {
        if (!(await isPortActive())) {
            console.warn(`[BrowserWatchdog] Port ${DEBUG_PORT} tidak aktif — restart...`);
            await restartBrowser();
        }
    }, CHECK_INTERVAL_MS);

    _watcherTimer.unref();
}

function stop() {
    if (_watcherTimer) {
        clearInterval(_watcherTimer);
        _watcherTimer = null;
        console.log('[BrowserWatchdog] Watchdog dihentikan.');
    }
}

async function ensureRunning() {
    if (!_browserAvailable) {
        const cdpUrl = process.env.CLOAK_CDP_URL || `http://${HOST_IP}:${DEBUG_PORT}`;
        console.log(`[BrowserWatchdog] Mode tanpa browser — mengembalikan CDP URL: ${cdpUrl}`);
        return { cdpUrl, port: DEBUG_PORT };
    }
    const alive = await isPortActive();
    if (!alive) await restartBrowser();
    return { cdpUrl: `http://${HOST_IP}:${DEBUG_PORT}`, port: DEBUG_PORT };
}

const CDP_URL = process.env.CLOAK_CDP_URL || `http://${HOST_IP}:${DEBUG_PORT}`;
module.exports = { start, stop, ensureRunning, isPortActive, CDP_URL, HOST_IP, DEBUG_PORT };
