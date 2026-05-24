'use strict';

/**
 * browserWatchdog.js — Playwright API Edition
 * ============================================
 * Menggunakan Playwright Node.js API (chromium.launch) untuk membuka browser,
 * BUKAN spawn binary mentah. Cara ini persis seperti yang dilakukan hermes-agent
 * di Ubuntu/Linux — browser dibuka otomatis oleh Playwright, tidak perlu install
 * atau jalankan apapun secara terpisah.
 *
 * Alur:
 *  1. start() → chromium.launch() dengan flag stealth
 *  2. Browser bind ke port CDP (CLOAK_DEBUG_PORT, default 9223)
 *  3. Hermes Python → chromium.connect_over_cdp("http://127.0.0.1:9223")
 *  4. MCP tool browser_navigate/click/type/screenshot langsung pakai _pwBrowser
 */

const net  = require('net');
const path = require('path');

const DEBUG_PORT = Number(process.env.CLOAK_DEBUG_PORT || 9223);
const HOST_IP    = '127.0.0.1';

let _pwBrowser   = null;
let _launched    = false;

/**
 * Cek apakah port TCP sudah aktif.
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
    return tryTcpConnect(HOST_IP, port);
}

/**
 * Temukan path Chromium: utamakan CHROMIUM_PATH env var (Nix-installed),
 * lalu fallback ke Playwright's downloaded binary.
 */
function resolveChromiumPath() {
    // 1. Env var eksplisit (di-set via Replit Secrets atau .env)
    if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

    // 2. Auto-detect Nix-installed chromium (path berubah setiap update Nix)
    const { execSync } = require('child_process');
    try {
        const nixPath = execSync('which chromium 2>/dev/null || which chromium-browser 2>/dev/null', {
            stdio: ['pipe', 'pipe', 'pipe'],
        }).toString().trim();
        if (nixPath) return nixPath;
    } catch (_) {}

    // 3. Playwright downloaded binary (mungkin gagal di NixOS karena library)
    const fspath = require('fs');
    const cacheDirs = [
        path.join(process.cwd(), '.cache', 'ms-playwright'),
        path.join(process.env.HOME || '', '.cache', 'ms-playwright'),
    ];
    const subDirs = ['chrome-linux64', 'chrome-linux', 'chrome-headless-shell-linux64'];
    const binNames = ['chrome', 'chromium', 'chrome-headless-shell'];
    for (const cacheDir of cacheDirs) {
        if (!fspath.existsSync(cacheDir)) continue;
        const dirs = fspath.readdirSync(cacheDir).filter(d => d.startsWith('chromium'));
        for (const dir of dirs.sort().reverse()) {
            for (const sub of subDirs) {
                for (const bin of binNames) {
                    const c = path.join(cacheDir, dir, sub, bin);
                    if (fspath.existsSync(c)) return c;
                }
            }
        }
    }

    return null;
}

async function launchWithPlaywright() {
    const { chromium } = require('playwright');

    const executablePath = resolveChromiumPath();
    if (executablePath) {
        console.log(`[BrowserWatchdog] Chromium: ${executablePath}`);
    } else {
        console.warn('[BrowserWatchdog] ⚠ Chromium tidak ditemukan — coba install: installSystemDependencies(["chromium"])');
    }

    console.log('[BrowserWatchdog] Membuka browser via Playwright API...');

    const launchOpts = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--window-size=1280,800',
        ],
    };

    // Gunakan Nix Chromium jika tersedia — ini penting di Replit/NixOS
    if (executablePath) launchOpts.executablePath = executablePath;

    _pwBrowser = await chromium.launch(launchOpts);

    console.log(`[BrowserWatchdog] ✅ Browser aktif — Chromium v${_pwBrowser.version()}`);

    // Buat satu tab awal (blank page) agar browser siap
    const ctx  = await _pwBrowser.newContext({
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport:  { width: 1280, height: 800 },
    });
    await ctx.newPage();
    console.log('[BrowserWatchdog] ✅ Tab awal dibuat — browser siap digunakan agent');

    _launched = true;
    return true;
}

/**
 * Start browser watchdog.
 * Dipanggil sekali di awal oleh start.js.
 */
async function start() {
    if (process.env.SKIP_BROWSER === 'true') {
        console.log('[BrowserWatchdog] SKIP_BROWSER=true — mode tanpa browser.');
        return;
    }

    // Jika port sudah aktif (misalnya dari sesi lain), tidak perlu launch lagi
    if (await isPortActive()) {
        console.log(`[BrowserWatchdog] ✅ Browser sudah aktif di port ${DEBUG_PORT} — skip launch.`);
        _launched = true;
        return;
    }

    try {
        await launchWithPlaywright();
        console.log(`[BrowserWatchdog] CDP URL: http://${HOST_IP}:${DEBUG_PORT}`);
        console.log('[BrowserWatchdog] Hermes agent bisa connect: chromium.connect_over_cdp("http://127.0.0.1:' + DEBUG_PORT + '")');
    } catch (err) {
        console.error(`[BrowserWatchdog] ❌ Gagal launch browser: ${err.message}`);
        console.error('[BrowserWatchdog] Agent tetap lanjut — tools browser tetap bekerja via Playwright langsung.');
    }
}

function stop() {
    if (_pwBrowser) {
        try { _pwBrowser.close(); } catch (_) {}
        _pwBrowser = null;
    }
    _launched = false;
}

async function ensureRunning() {
    if (!_launched) await start();
    return { available: _launched, port: DEBUG_PORT };
}

/**
 * Dapatkan Playwright browser object (untuk dipakai langsung oleh mcp_server.js).
 * Lebih efisien daripada connect_over_cdp karena tidak perlu round-trip HTTP.
 */
async function getBrowser() {
    if (!_pwBrowser) await start();
    return _pwBrowser;
}

const CDP_URL = process.env.CLOAK_CDP_URL || `http://${HOST_IP}:${DEBUG_PORT}`;
module.exports = { start, stop, ensureRunning, isPortActive, getBrowser, CDP_URL, HOST_IP, DEBUG_PORT };
