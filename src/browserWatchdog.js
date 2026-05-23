/**
 * browserWatchdog.js
 * ==================
 * Menjaga CloakBrowser tetap hidup selamanya.
 * Jika browser tertutup (port 9223 tidak aktif), watchdog otomatis
 * me-restart browser via PowerShell CIM agar tetap berjalan sebagai
 * proses mandiri yang tidak tergantung pada terminal/script Python.
 */

'use strict';

const net        = require('net');
const { exec }   = require('child_process');
const path       = require('path');
const fs         = require('fs');

// ── KONFIGURASI ──────────────────────────────────────────────────────────────
const CHROME_PATH  = String(
    process.env.CLOAK_CHROME_PATH ||
    String.raw`C:\Users\user\.antigravity\Nexus-DualBrain-AI\bin\cloak\chrome.exe`
);
const PROFILE_DIR  = String(
    process.env.CLOAK_PROFILE_DIR ||
    String.raw`bin\cloak_profile`
);
const DEBUG_PORT   = Number(process.env.CLOAK_DEBUG_PORT || 9223);
const CHECK_INTERVAL_MS = 5_000;   // cek setiap 5 detik
const RESTART_COOLDOWN_MS = 8_000; // tunggu sebelum restart berikutnya
// ─────────────────────────────────────────────────────────────────────────────

let _watcherTimer    = null;
let _lastRestartTime = 0;
let _restartCount    = 0;
let _isRestarting    = false;

/** Cek apakah port CDP aktif (non-blocking). */
function isPortActive(port = DEBUG_PORT) {
    return new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(1000);
        sock
            .once('connect', () => { sock.destroy(); resolve(true); })
            .once('timeout',  () => { sock.destroy(); resolve(false); })
            .once('error',    () => { sock.destroy(); resolve(false); })
            .connect(port, '127.0.0.1');
    });
}

/** Hapus lock files agar Chrome tidak loop error. */
function clearLockFiles() {
    const locks = ['LOCK', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    for (const f of locks) {
        const p = path.join(PROFILE_DIR, f);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    }
}

/** Matikan semua proses chrome yang masih jalan. */
function killCloakProcesses() {
    return new Promise(resolve => {
        exec('taskkill /F /IM chrome.exe', () => resolve());
    });
}

/**
 * Launch CloakBrowser sebagai proses MANDIRI via PowerShell CIM.
 * Browser tetap hidup setelah script Node.js selesai / crash.
 */
function launchDetached() {
    const command = [
        `"${CHROME_PATH}"`,
        `--user-data-dir="${PROFILE_DIR}"`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--disable-blink-features=AutomationControlled`,
        `--no-sandbox`,
        `--start-maximized`,
    ].join(' ');

    const ps = [
        `Invoke-CimMethod`,
        `-ClassName Win32_Process`,
        `-MethodName Create`,
        `-Arguments @{CommandLine='${command}'}`,
    ].join(' ');

    return new Promise((resolve, reject) => {
        exec(`powershell -Command "${ps}"`, (err, stdout, stderr) => {
            if (err) { reject(new Error(stderr || err.message)); }
            else { resolve(stdout.trim()); }
        });
    });
}

/** Jalankan satu siklus restart lengkap. */
async function restartBrowser() {
    if (_isRestarting) return;
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

        // Tunggu sampai port aktif (maks 15 detik)
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1000));
            if (await isPortActive()) {
                console.log(`[BrowserWatchdog] CloakBrowser aktif di port ${DEBUG_PORT}.`);
                break;
            }
        }
    } catch (err) {
        console.error(`[BrowserWatchdog] Gagal restart: ${err.message}`);
        console.error(`[BrowserWatchdog] Periksa path: ${CHROME_PATH}`);
    } finally {
        _isRestarting = false;
    }
}

/**
 * Mulai watchdog — jalankan sekali, terus hidup.
 * Langsung launch browser jika belum aktif, lalu poll setiap 5 detik.
 */
async function start() {
    console.log(`[BrowserWatchdog] Memulai watchdog CloakBrowser (port ${DEBUG_PORT})...`);

    // Launch segera jika belum aktif
    if (!(await isPortActive())) {
        await restartBrowser();
    } else {
        console.log(`[BrowserWatchdog] CloakBrowser sudah aktif di port ${DEBUG_PORT}.`);
    }

    // Poll berkala
    _watcherTimer = setInterval(async () => {
        const alive = await isPortActive();
        if (!alive) {
            console.warn(`[BrowserWatchdog] Port ${DEBUG_PORT} tidak aktif — memulai restart...`);
            await restartBrowser();
        }
    }, CHECK_INTERVAL_MS);

    _watcherTimer.unref(); // jangan blokir process exit jika semua task selesai
}

/** Hentikan watchdog (dipanggil saat graceful shutdown). */
function stop() {
    if (_watcherTimer) {
        clearInterval(_watcherTimer);
        _watcherTimer = null;
        console.log('[BrowserWatchdog] Watchdog dihentikan.');
    }
}

/** Pastikan browser aktif sekarang (dipanggil dari MCP server). */
async function ensureRunning() {
    const alive = await isPortActive();
    if (!alive) {
        console.log('[BrowserWatchdog] Browser tidak aktif, me-restart sekarang...');
        await restartBrowser();
    }
    return { cdpUrl: `http://127.0.0.1:${DEBUG_PORT}`, port: DEBUG_PORT };
}

module.exports = { start, stop, ensureRunning, isPortActive, CDP_URL: `http://127.0.0.1:${DEBUG_PORT}` };
