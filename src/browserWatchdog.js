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
 * Buat Windows port proxy agar port 9223 Windows-localhost bisa diakses dari WSL.
 * Chrome di Windows bind ke 127.0.0.1 — tidak visible dari WSL2 secara default.
 * netsh portproxy membuat Windows forward koneksi dari semua interface ke loopback.
 * Referensi: https://github.com/microsoft/WSL/issues/4150#issuecomment-504209723
 */
function setupPortProxy() {
    return new Promise(resolve => {
        const cmd = `netsh.exe interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=${DEBUG_PORT} connectaddress=127.0.0.1 connectport=${DEBUG_PORT}`;
        require('child_process').exec(cmd, { timeout: 5000 }, (err) => {
            if (err) {
                console.warn(`[BrowserWatchdog] Port proxy: ${err.message.split('\n')[0]}`);
            } else {
                console.log(`[BrowserWatchdog] Port proxy aktif: 0.0.0.0:${DEBUG_PORT} → 127.0.0.1:${DEBUG_PORT}`);
            }
            resolve();
        });
    });
}

/**
 * Cek apakah Chrome benar-benar binding port di Windows (diagnostic).
 * Gunakan netstat.exe dari WSL untuk melihat Windows ports.
 */
function checkWindowsPort() {
    return new Promise(resolve => {
        const { exec: _exec } = require('child_process');
        _exec(`netstat.exe -an 2>/dev/null | grep ${DEBUG_PORT}`, { timeout: 5000 }, (err, stdout) => {
            if (stdout && stdout.includes(String(DEBUG_PORT))) {
                console.log(`[BrowserWatchdog] ℹ Windows netstat: port ${DEBUG_PORT} ditemukan → Chrome berjalan, masalah di WSL networking`);
                console.log(`[BrowserWatchdog]   ${stdout.trim().split('\n')[0]}`);
            } else {
                console.warn(`[BrowserWatchdog] ⚠ Windows netstat: port ${DEBUG_PORT} TIDAK ditemukan → Chrome belum bind port atau crash`);
                console.warn('[BrowserWatchdog]   Cek: apakah CloakBrowser terbuka di Windows?');
            }
            resolve();
        });
    });
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
        console.error('[BrowserWatchdog] ❌ Gagal spawn — agent lanjut tanpa browser.');
        return;
    }

    // Beri Chrome 3 detik untuk bind port ke Windows 127.0.0.1
    await new Promise(r => setTimeout(r, 3000));

    // ── Windows Port Proxy ─────────────────────────────────────────
    // Chrome di Windows bind ke 127.0.0.1:9223 (Windows-only).
    // Dari WSL2, kita tidak bisa langsung akses 127.0.0.1 Windows.
    // Solusi: netsh portproxy — buat Windows forward HOST_IP:9223 → 127.0.0.1:9223.
    // Setelah ini, dari WSL: HOST_IP:9223 bisa diakses.
    await setupPortProxy();

    // Tunggu browser siap — maks 25 detik, cek setiap detik
    console.log('[BrowserWatchdog] Menunggu CloakBrowser siap di port ' + DEBUG_PORT + '...');
    for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 1000));
        if (await isPortActive()) {
            console.log(`[BrowserWatchdog] ✅ CloakBrowser aktif di port ${DEBUG_PORT}!`);
            _launched = true;
            return;
        }
        if (i === 7) {
            // Cek apakah Chrome benar-benar binding port di Windows
            await checkWindowsPort();
        }
    }
    console.warn(`[BrowserWatchdog] ⚠ Port ${DEBUG_PORT} tidak terjangkau dari WSL setelah 25 detik.`);
    console.warn('[BrowserWatchdog] Chrome mungkin berjalan tapi port tidak accessible dari WSL.');
    console.warn('[BrowserWatchdog] Solusi manual: buka CloakBrowser dari Windows, lalu set di .env:');
    console.warn(`[BrowserWatchdog]   CLOAK_CDP_URL=http://${HOST_IP}:${DEBUG_PORT}`);
    console.warn('[BrowserWatchdog] Agent tetap lanjut — Hermes akan coba konek ke browser.');
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
