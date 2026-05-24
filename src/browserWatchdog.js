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

const net                    = require('net');
const { spawn }              = require('child_process');
const path                   = require('path');
const fs                     = require('fs');
const { execSync }           = require('child_process');

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
 * Coba HOST_IP (Windows gateway dari WSL) lalu 127.0.0.1 (WSL mirrored networking).
 * Timeout per percobaan: 1.5 detik.
 */
function tryTcpConnect(host, port) {
    return new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(1500);
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('timeout',  () => { sock.destroy(); resolve(false); });
        sock.once('error',    () => { sock.destroy(); resolve(false); });
        sock.connect(port, host);
    });
}

async function isPortActive(port = DEBUG_PORT) {
    if (await tryTcpConnect(HOST_IP, port)) return true;
    if (await tryTcpConnect('127.0.0.1', port)) return true;
    return false;
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
 * Launch CloakBrowser — sama persis dengan command yang user konfirmasi bekerja:
 *
 *   "/mnt/c/.../chrome.exe" \
 *     --user-data-dir="C:\...\cloak_profile" \
 *     --remote-debugging-port=9223 \
 *     --remote-debugging-address=0.0.0.0 \
 *     --disable-blink-features=AutomationControlled \
 *     --no-sandbox --start-maximized &
 *
 * Node.js equivalent: spawn + detached:true + unref()
 * detached = proses mandiri (tidak ikut mati ketika Node.js berhenti)
 * unref()  = Node.js tidak menunggu proses ini selesai
 */
function launchBrowser() {
    return new Promise(resolve => {
        try {
            const child = spawn(CHROME_PATH, [
                `--user-data-dir=${PROFILE_DIR}`,
                `--remote-debugging-port=${DEBUG_PORT}`,
                `--remote-debugging-address=0.0.0.0`,
                `--remote-allow-origins=*`,
                `--disable-blink-features=AutomationControlled`,
                `--no-sandbox`,
                `--start-maximized`,
            ], {
                detached: true,   // proses mandiri — tidak ikut mati
                stdio:    'ignore',
                shell:    false,
            });
            child.unref(); // lepaskan dari event loop Node.js
            console.log(`[BrowserWatchdog] ✅ CloakBrowser diluncurkan (PID: ${child.pid})`);
            resolve(true);
        } catch (err) {
            console.error(`[BrowserWatchdog] spawn gagal: ${err.message}`);
            resolve(false);
        }
    });
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

    console.log('[BrowserWatchdog] Membersihkan lock files profil...');
    clearLockFiles();

    console.log('[BrowserWatchdog] Meluncurkan CloakBrowser...');
    const ok = await launchBrowser();
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
