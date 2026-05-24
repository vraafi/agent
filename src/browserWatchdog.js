'use strict';

/**
 * browserWatchdog.js
 * ==================
 * Buka CloakBrowser SEKALI saja saat startup, lalu biarkan berjalan selamanya.
 *
 * ATURAN:
 *  - TIDAK PERNAH kill chrome.exe (agar browser biasa user tidak ikut tertutup)
 *  - Hanya launch jika port belum aktif
 *  - Gunakan PowerShell CIM untuk detach yang benar dari WSL (terbukti di launch_stable_linkedin.py)
 *  - --remote-debugging-address=0.0.0.0 agar port bisa diakses dari WSL via HOST_IP
 */

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

const HOST_IP    = getHostIP();
const CHROME_PATH = String(process.env.CLOAK_CHROME_PATH || '/mnt/c/Users/user/.antigravity/Nexus-DualBrain-AI/bin/cloak/chrome.exe');
const PROFILE_DIR = String(process.env.CLOAK_PROFILE_DIR || 'C:\\Users\\user\\.antigravity\\Nexus-DualBrain-AI\\bin\\cloak_profile');
const DEBUG_PORT  = Number(process.env.CLOAK_DEBUG_PORT || 9223);

let _browserAvailable = false;
let _launched         = false;

function detectBrowserSupport() {
    if (process.env.SKIP_BROWSER === 'true') {
        console.log('[BrowserWatchdog] SKIP_BROWSER=true — mode tanpa browser.');
        return false;
    }
    if (process.platform === 'linux') {
        try {
            if (fs.existsSync(CHROME_PATH)) {
                console.log(`[BrowserWatchdog] ✅ CloakBrowser: ${CHROME_PATH}`);
                return true;
            }
        } catch (_) {}
        console.log('[BrowserWatchdog] ⚠ CloakBrowser tidak ditemukan — mode teks saja.');
        return false;
    }
    return true;
}

/**
 * Cek apakah CDP port aktif.
 * Coba HOST_IP (Windows gateway dari WSL) dan 127.0.0.1 (jika mirrored networking).
 */
function isPortActive(port = DEBUG_PORT) {
    const tryHost = (host) => new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(1200);
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('timeout',  () => { sock.destroy(); resolve(false); });
        sock.once('error',    () => { sock.destroy(); resolve(false); });
        sock.connect(port, host);
    });

    return Promise.race([
        tryHost(HOST_IP),
        tryHost('127.0.0.1'),
    ]).then(r => r || Promise.all([tryHost(HOST_IP), tryHost('127.0.0.1')]).then(([a, b]) => a || b));
}

/**
 * Bersihkan lock file profil agar Chrome tidak hang.
 * TIDAK membunuh proses Chrome manapun.
 */
function clearLockFiles() {
    const locks = ['LOCK', 'SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    let targetDir = PROFILE_DIR;
    if (process.platform === 'linux' && targetDir.startsWith('C:\\')) {
        targetDir = '/mnt/c/' + targetDir.substring(3).replace(/\\/g, '/');
    }
    for (const f of locks) {
        const p = path.join(targetDir, f);
        try { if (fs.existsSync(p)) { fs.unlinkSync(p); console.log(`[BrowserWatchdog] Lock dihapus: ${f}`); } } catch (_) {}
    }
}

/**
 * Launch CloakBrowser menggunakan PowerShell CIM — metode yang terbukti berhasil.
 * CIM membuat proses Windows MANDIRI, terpisah dari WSL/Node.js.
 * Tidak ada risiko browser ikut mati ketika agen dihentikan.
 *
 * Referensi: launch_stable_linkedin.py (sudah terbukti di proyek ini)
 */
function launchViaCIM() {
    const winArgs = [
        `"${CHROME_PATH.replace(/\//g, '\\').replace('/mnt/c/', 'C:\\')}"`,
        `--user-data-dir="${PROFILE_DIR}"`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--remote-debugging-address=0.0.0.0`,
        `--remote-allow-origins=*`,
        `--disable-blink-features=AutomationControlled`,
        `--no-sandbox`,
        `--start-maximized`,
    ].join(' ');

    const ps = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine='${winArgs}'}`;
    const cmd = process.platform === 'linux' ? 'powershell.exe' : 'powershell';

    return new Promise(resolve => {
        exec(`${cmd} -Command "${ps}"`, { timeout: 10_000 }, (err, stdout, stderr) => {
            if (err) {
                console.error(`[BrowserWatchdog] PowerShell CIM gagal: ${err.message}`);
                resolve(false);
            } else {
                const pid = (stdout.match(/ProcessId\s*:\s*(\d+)/) || [])[1] || '?';
                console.log(`[BrowserWatchdog] ✅ CloakBrowser diluncurkan via CIM (PID Windows: ${pid})`);
                resolve(true);
            }
        });
    });
}

/**
 * Cek apakah PowerShell tersedia di sistem (WSL harus punya powershell.exe).
 */
function hasPowerShell() {
    try { execSync('which powershell.exe', { stdio: 'pipe' }); return true; } catch (_) {}
    try { execSync('which powershell', { stdio: 'pipe' }); return true; } catch (_) {}
    return false;
}

async function start() {
    _browserAvailable = detectBrowserSupport();
    if (!_browserAvailable) return;

    console.log(`[BrowserWatchdog] Cek CDP port ${DEBUG_PORT}...`);

    if (await isPortActive()) {
        console.log(`[BrowserWatchdog] ✅ CloakBrowser sudah aktif di port ${DEBUG_PORT} — skip launch.`);
        _launched = true;
        return;
    }

    if (!hasPowerShell()) {
        console.warn('[BrowserWatchdog] ⚠ powershell.exe tidak tersedia — tidak bisa launch otomatis.');
        console.warn(`[BrowserWatchdog] Jalankan CloakBrowser manual di Windows lalu set:`);
        console.warn(`[BrowserWatchdog]   CLOAK_CDP_URL=http://${HOST_IP}:${DEBUG_PORT} di .env`);
        return;
    }

    console.log('[BrowserWatchdog] Membersihkan lock files profil...');
    clearLockFiles();

    console.log('[BrowserWatchdog] Meluncurkan CloakBrowser (PowerShell CIM)...');
    const ok = await launchViaCIM();
    if (!ok) {
        console.error('[BrowserWatchdog] ❌ Gagal launch — agent lanjut tanpa browser.');
        return;
    }

    // Tunggu browser siap — maks 20 detik
    console.log('[BrowserWatchdog] Menunggu CloakBrowser siap...');
    for (let i = 0; i < 20; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await isPortActive()) {
            console.log(`[BrowserWatchdog] ✅ CloakBrowser aktif di port ${DEBUG_PORT}!`);
            _launched = true;
            return;
        }
        if (i === 9) console.log('[BrowserWatchdog] Masih menunggu browser...');
    }
    console.warn(`[BrowserWatchdog] ⚠ Port ${DEBUG_PORT} belum aktif setelah 20 detik.`);
    console.warn('[BrowserWatchdog] Kemungkinan penyebab:');
    console.warn('  1. Profile dir salah atau terkunci');
    console.warn('  2. Firewall Windows blokir port 9223');
    console.warn('  3. CloakBrowser crash saat startup');
    console.warn('[BrowserWatchdog] Agent tetap lanjut — browser bisa disambung nanti.');
}

function stop() {}

async function ensureRunning() {
    if (!_browserAvailable) {
        const cdpUrl = process.env.CLOAK_CDP_URL || `http://${HOST_IP}:${DEBUG_PORT}`;
        return { cdpUrl, port: DEBUG_PORT };
    }
    const alive = await isPortActive();
    if (!alive && !_launched) await start();
    return { cdpUrl: `http://${HOST_IP}:${DEBUG_PORT}`, port: DEBUG_PORT };
}

const CDP_URL = process.env.CLOAK_CDP_URL || `http://${HOST_IP}:${DEBUG_PORT}`;
module.exports = { start, stop, ensureRunning, isPortActive, CDP_URL, HOST_IP, DEBUG_PORT };
