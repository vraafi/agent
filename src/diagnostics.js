'use strict';

/**
 * diagnostics.js
 * ==============
 * Jalankan sebelum start untuk mendeteksi masalah konfigurasi.
 * Setiap masalah diberi status: OK | WARN | ERROR
 * ERROR = agent tidak akan berjalan dengan benar
 * WARN  = fitur tertentu tidak akan bekerja, tapi agent tetap bisa jalan
 */

const net  = require('net');
const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';

function ok(label, msg)   { console.log(`  ${GREEN}✅ OK   ${RESET} ${BOLD}${label}${RESET}: ${msg}`); }
function warn(label, msg) { console.log(`  ${YELLOW}⚠  WARN ${RESET} ${BOLD}${label}${RESET}: ${msg}`); }
function err(label, msg)  { console.log(`  ${RED}❌ ERROR${RESET} ${BOLD}${label}${RESET}: ${msg}`); }
function info(msg)        { console.log(`  ${CYAN}ℹ  INFO ${RESET} ${msg}`); }

function checkTcpPort(host, port, timeoutMs = 2000) {
    return new Promise(resolve => {
        const sock = new net.Socket();
        sock.setTimeout(timeoutMs);
        sock.once('connect', () => { sock.destroy(); resolve(true); });
        sock.once('timeout',  () => { sock.destroy(); resolve(false); });
        sock.once('error',    () => { sock.destroy(); resolve(false); });
        sock.connect(port, host);
    });
}

async function checkHttpHealth(url, timeoutMs = 5000) {
    try {
        const http  = url.startsWith('https') ? require('https') : require('http');
        return await new Promise(resolve => {
            const req = http.get(url, { timeout: timeoutMs }, res => {
                resolve({ ok: res.statusCode < 500, status: res.statusCode });
            });
            req.on('error', e => resolve({ ok: false, error: e.message }));
            req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
        });
    } catch (e) {
        return { ok: false, error: e.message };
    }
}

async function runDiagnostics() {
    const errors  = [];
    const warns   = [];

    console.log('\n' + BOLD + '═'.repeat(60) + RESET);
    console.log(BOLD + '  🔍 HermesMoneyAgent — DIAGNOSTICS' + RESET);
    console.log(BOLD + '═'.repeat(60) + RESET + '\n');

    // ─────────────────────────────────────────────────────────────
    // 1. ENVIRONMENT — .env file
    // ─────────────────────────────────────────────────────────────
    console.log(BOLD + '[ 1 ] Environment (.env)' + RESET);

    const envPath = path.join(__dirname, '..', '.env');
    if (fs.existsSync(envPath)) {
        ok('.env', 'File ditemukan');
    } else {
        err('.env', 'File tidak ditemukan! Salin .env.example → .env');
        errors.push('.env file tidak ada');
    }

    // ─────────────────────────────────────────────────────────────
    // 2. GEMINI API KEYS
    // ─────────────────────────────────────────────────────────────
    console.log('\n' + BOLD + '[ 2 ] Gemini API Keys' + RESET);
    const geminiKeys = [];
    for (let i = 1; i <= 10; i++) {
        const k = process.env[`GEMINI_API_KEY_${i}`];
        if (k && k.trim()) geminiKeys.push(i);
    }
    if (geminiKeys.length >= 1) {
        ok('Gemini Keys', `${geminiKeys.length}/10 key tersedia (key #${geminiKeys.join(', #')})`);
    } else {
        warn('Gemini Keys', 'Tidak ada key Gemini — rotasi tidak aktif. Pastikan isi GEMINI_API_KEY_1 ... _10 di .env');
        warns.push('Tidak ada Gemini API key');
    }

    // ─────────────────────────────────────────────────────────────
    // 3. 9ROUTER
    // ─────────────────────────────────────────────────────────────
    console.log('\n' + BOLD + '[ 3 ] 9Router / API Gateway' + RESET);

    const externalUrl = process.env.NINEROUTER_EXTERNAL_URL || '';
    const localPort   = Number(process.env.NINEROUTER_PORT || 8080);

    if (externalUrl) {
        // Cek apakah URL sudah berakhiran /v1 (hindari double /v1/v1)
        if (externalUrl.endsWith('/v1')) {
            warn('NINEROUTER_EXTERNAL_URL', `URL berakhiran "/v1" → akan jadi double "/v1/v1" saat diteruskan ke Hermes. Hapus bagian "/v1" dari .env.\n              Contoh benar: http://107.173.51.78`);
            warns.push('NINEROUTER_EXTERNAL_URL berakhiran /v1 → akan double /v1/v1');
        } else {
            ok('NINEROUTER_EXTERNAL_URL', externalUrl);
        }

        // Health check ke VPS
        const healthUrl = externalUrl.replace(/\/v1$/, '') + '/api/health';
        info(`Health check: ${healthUrl}`);
        const health = await checkHttpHealth(healthUrl, 6000);
        if (health.ok) {
            ok('9Router VPS', `Terjangkau (HTTP ${health.status})`);
        } else {
            warn('9Router VPS', `Tidak terjangkau — ${health.error || 'HTTP ' + health.status}. Agent mungkin tidak bisa memanggil LLM.`);
            warns.push('9Router VPS tidak terjangkau');
        }

    } else {
        info('Mode lokal — menggunakan folder 9router/');
        const nineRouterDir = path.join(__dirname, '..', '9router');
        if (!fs.existsSync(nineRouterDir) || !fs.existsSync(path.join(nineRouterDir, 'package.json'))) {
            err('9Router lokal', 'Folder 9router/ tidak ada atau belum di-install. Jalankan: cd 9router && npm install && npm run build');
            errors.push('9Router lokal tidak tersedia');
        } else {
            ok('9Router lokal', `Folder ditemukan (port akan ${localPort})`);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 4. HERMES AGENT
    // ─────────────────────────────────────────────────────────────
    console.log('\n' + BOLD + '[ 4 ] Hermes Agent (Python)' + RESET);

    const hermesDir = path.join(__dirname, '..', 'hermes-agent');
    const venvPy    = path.join(__dirname, '..', 'venv', 'bin', 'python');
    const hermesCli = path.join(hermesDir, 'cli.py');

    if (!fs.existsSync(hermesDir) || !fs.readdirSync(hermesDir).length) {
        err('hermes-agent/', 'Folder kosong atau tidak ada. Jalankan: cd hermes-agent && ./scripts/install.sh');
        errors.push('Hermes Agent tidak terinstall');
    } else {
        ok('hermes-agent/', 'Folder ada');
    }

    if (!fs.existsSync(venvPy)) {
        err('venv Python', `Python venv tidak ditemukan di ${venvPy}. Jalankan: cd hermes-agent && ./scripts/install.sh`);
        errors.push('Python venv belum dibuat');
    } else {
        // Cek versi Python
        try {
            const ver = execSync(`"${venvPy}" --version 2>&1`, { stdio: 'pipe' }).toString().trim();
            ok('venv Python', ver);
        } catch (_) {
            warn('venv Python', 'Tidak bisa cek versi');
        }

        // Cek module websockets (diperlukan untuk browser_dialog_tool)
        try {
            execSync(`"${venvPy}" -c "import websockets"`, { stdio: 'pipe' });
            ok('websockets', 'Module tersedia');
        } catch (_) {
            warn('websockets', 'Module tidak ada → browser_dialog_tool tidak aktif. Fix: source venv/bin/activate && pip install websockets');
            warns.push('Python module "websockets" tidak terinstall');
        }

        // Cek cli.py
        if (!fs.existsSync(hermesCli)) {
            err('cli.py', `Tidak ditemukan di ${hermesCli}`);
            errors.push('Hermes cli.py tidak ada');
        } else {
            ok('cli.py', 'Ditemukan');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 5. CLOAK BROWSER
    // ─────────────────────────────────────────────────────────────
    console.log('\n' + BOLD + '[ 5 ] CloakBrowser' + RESET);

    const skipBrowser = process.env.SKIP_BROWSER === 'true';
    const cloakPath   = process.env.CLOAK_CHROME_PATH || '/mnt/c/Users/user/.antigravity/Nexus-DualBrain-AI/bin/cloak/chrome.exe';
    const cloakPort   = Number(process.env.CLOAK_DEBUG_PORT || 9223);
    const cloakHost   = process.env.CLOAK_HOST || '127.0.0.1';

    if (skipBrowser) {
        warn('CloakBrowser', 'SKIP_BROWSER=true — browser dinonaktifkan. PlatformSetup akan dilewati otomatis.');
    } else if (!fs.existsSync(cloakPath)) {
        warn('CloakBrowser', `Binary tidak ditemukan di: ${cloakPath}\n              Set CLOAK_CHROME_PATH di .env atau SKIP_BROWSER=true`);
        warns.push('CloakBrowser binary tidak ditemukan');
    } else {
        ok('CloakBrowser binary', cloakPath);
        // Cek apakah CDP port sudah aktif
        const cdpAlive = await checkTcpPort(cloakHost, cloakPort);
        if (cdpAlive) {
            ok(`CDP port ${cloakPort}`, `Aktif di ${cloakHost}:${cloakPort}`);
        } else {
            warn(`CDP port ${cloakPort}`, `Belum aktif — Watchdog akan launch otomatis`);
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 6. TELEGRAM
    // ─────────────────────────────────────────────────────────────
    console.log('\n' + BOLD + '[ 6 ] Telegram' + RESET);

    const tgToken  = process.env.TELEGRAM_BOT_TOKEN || '';
    const tgChatId = process.env.TELEGRAM_CHAT_ID   || '';

    if (!tgToken || !tgChatId) {
        warn('Telegram', 'TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID kosong — notifikasi Telegram dinonaktifkan.');
        warns.push('Telegram tidak dikonfigurasi');
    } else {
        ok('Telegram token', `${tgToken.slice(0, 10)}...`);
        ok('Telegram chat ID', tgChatId);

        // Cek apakah api.telegram.org bisa dijangkau
        const reachable = await checkTcpPort('api.telegram.org', 443, 4000);
        if (reachable) {
            ok('Telegram network', 'api.telegram.org:443 terjangkau');
        } else {
            warn('Telegram network', 'Tidak bisa connect ke api.telegram.org:443 — notifikasi Telegram tidak aktif, tapi agent tetap jalan.\n              Tip WSL: pastikan firewall Windows tidak blokir WSL, atau coba: wsl --shutdown lalu buka ulang.');
            warns.push('Telegram network tidak terjangkau (notifikasi nonaktif)');
        }
    }

    // ─────────────────────────────────────────────────────────────
    // 7. PLATFORM CREDENTIALS
    // ─────────────────────────────────────────────────────────────
    console.log('\n' + BOLD + '[ 7 ] Platform Credentials' + RESET);

    const email    = process.env.PLATFORM_EMAIL    || '';
    const password = process.env.PLATFORM_PASSWORD || '';

    if (!email) {
        warn('PLATFORM_EMAIL', 'Kosong — auto-setup platform akan dilewati');
        warns.push('PLATFORM_EMAIL tidak diset');
    } else {
        ok('PLATFORM_EMAIL', email);
    }
    if (!password) {
        warn('PLATFORM_PASSWORD', 'Kosong — login otomatis tidak bisa');
        warns.push('PLATFORM_PASSWORD tidak diset');
    } else {
        ok('PLATFORM_PASSWORD', '****** (terisi)');
    }

    // ─────────────────────────────────────────────────────────────
    // RINGKASAN
    // ─────────────────────────────────────────────────────────────
    console.log('\n' + BOLD + '═'.repeat(60) + RESET);
    console.log(BOLD + '  📋 RINGKASAN DIAGNOSTICS' + RESET);
    console.log(BOLD + '═'.repeat(60) + RESET);

    if (errors.length === 0 && warns.length === 0) {
        console.log(`\n  ${GREEN}${BOLD}🎉 Semua cek LULUS — agent siap dijalankan!${RESET}\n`);
    } else {
        if (errors.length > 0) {
            console.log(`\n  ${RED}${BOLD}❌ ${errors.length} ERROR (harus diperbaiki):${RESET}`);
            errors.forEach((e, i) => console.log(`     ${i + 1}. ${e}`));
        }
        if (warns.length > 0) {
            console.log(`\n  ${YELLOW}${BOLD}⚠  ${warns.length} PERINGATAN (fitur tertentu tidak aktif):${RESET}`);
            warns.forEach((w, i) => console.log(`     ${i + 1}. ${w}`));
        }
        console.log('');
    }
    console.log(BOLD + '═'.repeat(60) + RESET + '\n');

    return { errors, warns, hasErrors: errors.length > 0 };
}

module.exports = { runDiagnostics };
