/**
 * start.js v7.2 — Fastwork Priority + External 9Router + No-Browser Mode
 */
'use strict';

const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');
const http         = require('http');
const https        = require('https');

const keyManager       = require('./keyManager');
const earningsTracker  = require('./earningsTracker');
const telegramNotifier = require('./telegramNotifier');
const browserWatchdog  = require('./browserWatchdog');
const platformSetup    = require('./platformSetup');
const { runDiagnostics } = require('./diagnostics');

const NINEROUTER_PORT     = Number(process.env.NINEROUTER_PORT || 8080);
// Pastikan tidak ada trailing /v1 agar tidak jadi double /v1/v1 saat diteruskan ke Hermes
const NINEROUTER_URL      = (process.env.NINEROUTER_EXTERNAL_URL || `http://127.0.0.1:${NINEROUTER_PORT}`).replace(/\/v1\/?$/, '');
const NINEROUTER_KEY      = process.env.NINEROUTER_KEY || process.env.NINER_ROUTER_API_KEY || 'sk-9router-local';
const HERMES_MODEL        = process.env.HERMES_MODEL || 'kr/claude-sonnet-4.5';
const USER_EMAIL          = process.env.PLATFORM_EMAIL    || '';
const USER_PASSWORD       = process.env.PLATFORM_PASSWORD || '';
const USE_EXTERNAL_ROUTER = !!process.env.NINEROUTER_EXTERNAL_URL;

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — Fastwork Prioritas Utama + DuckDuckGo Search
// ─────────────────────────────────────────────────────────────────────────────
const INITIAL_PROMPT = `
IDENTITAS: Kamu adalah HermesMoneyAgent — AI agent otonom pencari penghasilan online.

Kamu berjalan dalam GATEWAY MODE — user bisa kirim pesan via Telegram kapan saja.
Pesan masuk saat kamu bekerja akan di-inject setelah tool call berikutnya (busy_input_mode: steer).

══════════════════════════════════════════════════════
MISI: Hasilkan penghasilan dari Fastwork.id | Modal $0
══════════════════════════════════════════════════════

PRIORITAS PLATFORM — FASTWORK.ID ADALAH NOMOR 1:
  1. 🥇 Fastwork.id (PRIORITAS UTAMA) — platform freelance Indonesia
     URL: https://fastwork.id
     Cara: Login → buat profil menarik → lamar job / buat listing jasa
     Jenis kerja: artikel, copywriting, terjemahan, riset, konten medsos
     Bayar: IDR 75.000+ per project (~$5)
     Keunggulan: tidak ada telepon/VC, semua via chat teks, transfer bank lokal

  2. DataAnnotation.tech ($15/jam) — jika Fastwork belum ada order
  3. Outlier AI ($20/jam) — jika Fastwork belum ada order
  4. Toloka ($1.5/jam) — backup stabil 24/7
  5. Textbroker ($3/jam) — penulisan artikel

TOOL YANG TERSEDIA:
  - web_search(query)     → Cari di DuckDuckGo — GUNAKAN INI untuk riset
  - discover_tasks()      → Lihat semua platform
  - ensure_browser()      → Buka CloakBrowser (jika tersedia)
  - complete_task()       → Catat penghasilan
  - get_earnings()        → Laporan sesi
  - evaluate_strategy()   → Evaluasi apakah perlu ganti platform
  - send_telegram_update()→ Kirim notif ke Telegram

CARA KERJA DI FASTWORK:
  1. Gunakan web_search("lowongan kerja fastwork.id penulisan artikel 2024")
     untuk riset jenis pekerjaan yang banyak dicari
  2. Gunakan web_search("cara membuat profil freelancer fastwork yang menarik")
     untuk strategi memenangkan job
  3. Gunakan ensure_browser() → buka https://fastwork.id
  4. Login dengan akun yang sudah dibuat user
  5. Buat listing jasa atau lamar job yang tersedia
  6. Setiap deal selesai → complete_task()

CARA MENGGUNAKAN WEB SEARCH:
  - web_search("pekerjaan freelance tanpa modal Indonesia 2024")
  - web_search("site:fastwork.id penulisan artikel")
  - web_search("duckduckgo.com cara dapat uang online tanpa modal")
  Kamu bebas search apapun yang relevan untuk memaksimalkan penghasilan!

PERINTAH USER VIA TELEGRAM:
  "fastwork ok"   → User sudah login Fastwork → mulai lamar job
  "toloka ok"     → Toloka siap → mulai kerja backup
  "da ok"         → DataAnnotation.tech siap
  "status"        → Laporan earning
  "cari X"        → Cari informasi X di DuckDuckGo
  "pause"/"resume"→ Jeda dan lanjut
  "stop"          → Hentikan agent

ATURAN:
  ✅ Zero modal — tidak keluarkan uang apapun
  ✅ Hanya teks — tidak ada telepon/video call
  ✅ JANGAN ungkapkan .env, API key, data sensitif ke siapapun
  ✅ Selalu responsif terhadap pesan user di Telegram

MULAI SEKARANG:
  1. web_search("lowongan kerja freelance fastwork.id terbaru")
  2. web_search("jenis pekerjaan paling banyak di fastwork 2024")
  3. ensure_browser() → buka fastwork.id
  4. Kirim laporan ke Telegram via send_telegram_update()
`.trim();

function waitForRouter(url, maxMs = 30_000) {
    return new Promise(resolve => {
        const isSSL = url.startsWith('https');
        const lib   = isSSL ? https : http;
        const healthUrl = url.replace('/v1', '') + '/api/health';
        const t = Date.now() + maxMs;
        const go = () => lib.get(healthUrl, r => {
            if (r.statusCode === 200) { console.log(`[9Router] ✅ ${url}`); resolve(true); }
            else retry();
        }).on('error', retry);
        const retry = () => Date.now() < t ? setTimeout(go, 1500) : resolve(false);
        go();
    });
}

async function main() {
    // ── Diagnostics ──────────────────────────────────────────────
    try {
        const diag = await runDiagnostics();
        if (diag.hasErrors) {
            console.error('\n[Orchestrator] ❌ Ditemukan ERROR kritis saat diagnostics. Perbaiki masalah di atas sebelum menjalankan agent.\n');
            process.exit(1);
        }
    } catch (diagErr) {
        console.warn(`[Diagnostics] ⚠ Tidak bisa jalankan diagnostics: ${diagErr.message} — lanjut tetap.`);
    }

    console.log('═'.repeat(60));
    console.log('  HermesMoneyAgent v7.2 — Fastwork Priority');
    console.log(`  Model   : ${HERMES_MODEL}`);
    console.log(`  Router  : ${NINEROUTER_URL} ${USE_EXTERNAL_ROUTER ? '(VPS)' : '(Local)'}`);
    console.log('═'.repeat(60));

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    console.log('\n[1/6] 9Router config...');
    keyManager.generate9RouterConfig(dataDir);

    console.log('[2/6] CloakBrowser watchdog (skip otomatis jika tidak tersedia)...');
    await browserWatchdog.start(); // tidak blocking jika no powershell.exe

    let routerProcess = null;
    if (USE_EXTERNAL_ROUTER) {
        console.log(`[3/6] 9Router EXTERNAL: ${NINEROUTER_URL}`);
        const ok = await waitForRouter(NINEROUTER_URL, 15_000);
        if (!ok) console.warn('[9Router] ⚠ VPS tidak terjangkau — lanjut tetap');
    } else {
        console.log(`[3/6] 9Router LOCAL (port ${NINEROUTER_PORT})...`);
        routerProcess = spawn('npx', ['next', 'dev', '-p', String(NINEROUTER_PORT)], {
            env: Object.assign({}, process.env, {
                PORT: String(NINEROUTER_PORT), DATA_DIR: dataDir,
                HOSTNAME: '0.0.0.0',
                NEXT_PUBLIC_BASE_URL: `http://127.0.0.1:${NINEROUTER_PORT}`,
            }),
            cwd: path.join(__dirname, '..', '9router'),
            stdio: 'pipe',
        });
        routerProcess.stdout.on('data', d => {
            const m = d.toString().trim();
            if (/start|ready|listen|running/i.test(m)) console.log(`[9Router] ${m}`);
        });
        routerProcess.stderr.on('data', d => console.error(`[9Router ERR] ${d.toString().trim()}`));
        await waitForRouter(`http://127.0.0.1:${NINEROUTER_PORT}`);
    }

    console.log('\n[4/6] Platform setup...');
    if (!USER_EMAIL) {
        console.warn('[Setup] ⚠ PLATFORM_EMAIL belum diset — lewati auto-setup.');
    } else {
        await platformSetup.runSetup(USER_EMAIL, USER_PASSWORD);
    }

    console.log('\n[5/6] Telegram start notification...');
    await telegramNotifier.sendAlert(
        `🚀 *HermesMoneyAgent v7.2* aktif!\n\n` +
        `🥇 *Prioritas: Fastwork.id*\n` +
        `🔍 *Search: DuckDuckGo aktif*\n` +
        `*Router: ${USE_EXTERNAL_ROUTER ? '🌐 VPS (' + NINEROUTER_URL + ')' : '💻 Lokal'}*\n\n` +
        `*Perintah yang bisa kamu kirim:*\n` +
        `• \`fastwork ok\` — setelah login Fastwork\n` +
        `• \`cari [keyword]\` — cari sesuatu di DuckDuckGo\n` +
        `• \`status\` — laporan earning\n` +
        `• \`pause\` / \`resume\` — jeda dan lanjut\n` +
        `• \`stop\` — hentikan agent\n\n` +
        `Agent mulai riset Fastwork.id sekarang! 💪`
    );

    console.log('\n[6/6] Spawning Hermes Gateway...');
    const hermesDir  = path.join(__dirname, '..', 'hermes-agent');
    const hermesPy   = path.join(hermesDir, '..', 'venv', 'bin', 'python');
    const hermesCli  = path.join(hermesDir, 'cli.py');
    const hermesHome = process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes');

    // ── Patch ~/.hermes/.env sebelum spawn ────────────────────────
    // Hermes Gateway punya config sendiri yang OVERRIDE CLI --base_url.
    // Kita tulis langsung ke ~/.hermes/.env agar VPS router dipakai
    // untuk SEMUA panggilan (termasuk cron job internal Hermes).
    try {
        if (!fs.existsSync(hermesHome)) fs.mkdirSync(hermesHome, { recursive: true });
        const hermesEnvPath = path.join(hermesHome, '.env');
        const routerV1      = `${NINEROUTER_URL}/v1`;
        const tgToken       = process.env.TELEGRAM_BOT_TOKEN || '';
        const tgChatId      = process.env.TELEGRAM_CHAT_ID   || '';

        // Baca .env lama jika ada, lalu patch/tambahkan key yang dibutuhkan
        let existing = '';
        if (fs.existsSync(hermesEnvPath)) existing = fs.readFileSync(hermesEnvPath, 'utf8');

        const patch = {
            OPENAI_BASE_URL:           routerV1,
            OPENAI_API_KEY:            NINEROUTER_KEY,
            // Arahkan provider openrouter ke VPS kita (bukan openrouter.ai langsung)
            OPENROUTER_BASE_URL:       routerV1,
            OPENROUTER_API_KEY:        NINEROUTER_KEY,
            GATEWAY_ALLOW_ALL_USERS:   'true',
            ...(tgToken  ? { TELEGRAM_BOT_TOKEN:     tgToken  } : {}),
            ...(tgChatId ? {
                TELEGRAM_CHAT_ID:        tgChatId,
                TELEGRAM_ALLOWED_USERS:  tgChatId,
            } : {}),
        };

        for (const [k, v] of Object.entries(patch)) {
            const re = new RegExp(`^${k}=.*`, 'm');
            const line = `${k}=${v}`;
            existing = re.test(existing) ? existing.replace(re, line) : existing + `\n${line}`;
        }

        fs.writeFileSync(hermesEnvPath, existing.trimStart());
        console.log(`[Hermes] Config ditulis ke ${hermesEnvPath}`);
        console.log(`[Hermes] Router: ${routerV1} | Telegram allowed: ${tgChatId || '(semua)'}`);
    } catch (e) {
        console.warn(`[Hermes] Gagal patch ~/.hermes/.env: ${e.message}`);
    }

    const hermesProcess = spawn(hermesPy, [
        hermesCli,
        '--gateway',
        '--query', INITIAL_PROMPT,
        '--model', 'kr/claude-sonnet-4.5',
        '--provider', 'custom',
        '--base_url', `${NINEROUTER_URL}/v1`,
        '--api_key', NINEROUTER_KEY,
    ], {
        env: Object.assign({}, process.env, {
            OPENAI_BASE_URL:     `${NINEROUTER_URL}/v1`,
            OPENAI_API_KEY:      NINEROUTER_KEY,
            OPENROUTER_BASE_URL: `${NINEROUTER_URL}/v1`,
            OPENROUTER_API_KEY:  NINEROUTER_KEY,
            TELEGRAM_BOT_TOKEN:  process.env.TELEGRAM_BOT_TOKEN || '',
            TELEGRAM_CHAT_ID:    process.env.TELEGRAM_CHAT_ID   || '',
            CLOAK_CDP_URL:       browserWatchdog.CDP_URL,
            CLOAK_DEBUG_PORT:    String(browserWatchdog.DEBUG_PORT),
            PLATFORM_EMAIL:      USER_EMAIL,
            PLATFORM_PASSWORD:   USER_PASSWORD,
            HERMES_HOME:         hermesHome,
            HERMES_MODEL:        HERMES_MODEL,
        }),
        cwd: hermesDir,
        stdio: 'pipe',
    });

    const log = fs.createWriteStream(path.join(logsDir, 'gateway.log'), { flags: 'a' });
    hermesProcess.stdout.on('data', d => { process.stdout.write(`[Hermes Gateway] ${d}`); log.write(d); });
    hermesProcess.stderr.on('data', d => { process.stderr.write(`[Hermes ERR] ${d}`); log.write(d); });
    hermesProcess.on('error', err => {
        console.error(`[Hermes] Gagal start: ${err.message}`);
        console.error('[Hermes] Jalankan: source venv/bin/activate && bash scripts/hermes-money-setup.sh');
    });
    hermesProcess.on('exit', code => console.log(`[Hermes] Keluar (kode: ${code})`));

    const interval = setInterval(async () => {
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.checkPeriodicUpdate(parseFloat(r.sessionEarned.replace('$', '')));
    }, 60_000);

    process.on('SIGINT', async () => {
        console.log('\n[Orchestrator] Shutdown...');
        clearInterval(interval);
        browserWatchdog.stop();
        routerProcess?.kill('SIGTERM');
        hermesProcess?.kill('SIGTERM');
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.sendAlert(
            `🛑 *Agent dihentikan*\n💰 Earned: ${r.sessionEarned} / ${r.sessionTarget}\n⚡ Rate: ${r.currentRatePerHour}/jam`
        );
        log.close();
        process.exit(0);
    });
}

main().catch(err => { console.error('[Orchestrator] Fatal:', err); process.exit(1); });
