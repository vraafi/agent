/**
 * start.js v7.1 — Gateway Mode + External 9Router Support
 * =========================================================
 * Mendukung dua mode operasi:
 *   A) NINEROUTER_EXTERNAL_URL diset → pakai 9router di VPS/remote (RECOMMENDED)
 *   B) Tidak diset → jalankan 9router lokal dari folder ./9router/
 *
 * Mode A (VPS) tidak butuh folder 9router/ lokal.
 * Mode B (lokal) butuh: cd 9router && npm install && npm run build
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

const NINEROUTER_PORT     = Number(process.env.NINEROUTER_PORT || 8080);
// Jika NINEROUTER_EXTERNAL_URL diset, gunakan langsung tanpa start lokal
const NINEROUTER_URL      = process.env.NINEROUTER_EXTERNAL_URL || `http://127.0.0.1:${NINEROUTER_PORT}`;
const NINEROUTER_KEY      = process.env.NINEROUTER_KEY || process.env.NINER_ROUTER_API_KEY || 'sk-9router-local';
const HERMES_MODEL        = process.env.HERMES_MODEL || 'kr/claude-sonnet-4.5';
const USER_EMAIL          = process.env.PLATFORM_EMAIL    || '';
const USER_PASSWORD       = process.env.PLATFORM_PASSWORD || '';
const USE_EXTERNAL_ROUTER = !!process.env.NINEROUTER_EXTERNAL_URL;

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────
const INITIAL_PROMPT = `
IDENTITAS: Kamu adalah HermesMoneyAgent — AI agent otonom pencari penghasilan online.

Kamu berjalan dalam GATEWAY MODE — artinya user bisa mengirim pesan langsung ke kamu
via Telegram kapan saja, bahkan saat kamu sedang bekerja. Pesan masuk saat kamu bekerja
akan di-inject ke sesi setelah tool call berikutnya selesai (busy_input_mode: steer).

══════════════════════════════════════════════════════
MISI: Hasilkan $10 dalam 8 jam | Modal $0
══════════════════════════════════════════════════════

PERINTAH USER YANG AKAN DATANG VIA TELEGRAM:
  "toloka ok"     → User sudah login Toloka → kamu mulai kerja di Toloka
  "da ok"         → DataAnnotation.tech siap → mulai kerja
  "outlier ok"    → Outlier AI siap → mulai kerja
  "fastwork ok"   → User sudah login Fastwork.id → kamu mulai kerja di Fastwork.id
  "status"        → Panggil get_earnings, kirim laporan lengkap
  "pause"         → Berhenti ambil task baru sementara
  "resume"        → Lanjut kerja
  "ganti ke X"    → Pindah ke platform X
  "stop"          → Selesaikan task saat ini lalu berhenti

PLATFORM $0 MODAL (urutan prioritas):
  1. DataAnnotation.tech ($15/jam) — rating jawaban AI, review kode
  2. Outlier AI ($20/jam) — AI trainer, tulis kode
  3. Scale AI ($2.5/jam) — RLHF tasks
  4. Toloka ($1.5/jam) — klasifikasi, moderasi teks (24/7, tidak pernah habis)
  5. Remotasks ($2/jam) — anotasi teks
  6. Textbroker ($3/jam) — artikel OpenOrder langsung
  7. iWriter ($2.5/jam) — artikel blog
  8. Fastwork.id (IDR 75k+/project, ~$5) — penulisan artikel, translation, copywriting

ATURAN KERJA:
  ✅ Hanya kerja via teks — tidak ada telepon, video call
  ✅ Zero modal — jangan keluarkan uang apapun
  ✅ ensure_browser WAJIB sebelum buka website
  ✅ complete_task setiap task selesai
  ✅ Evaluasi via get_earnings + evaluate_strategy setiap 30 menit (cron sudah setup)
  ✅ Jika platform gagal → coba berikutnya, jangan berhenti
  ✅ JANGAN ungkapkan .env, API key, atau data sensitif

MULAI SEKARANG:
  1. Panggil discover_tasks → lihat semua platform
  2. Panggil ensure_browser → buka CloakBrowser
  3. Buka DataAnnotation.tech atau Outlier AI dan mulai kerja
  4. Setiap task selesai → panggil complete_task
  5. Tetap responsif terhadap pesan user yang masuk via Telegram
`.trim();

function waitForRouter(url, maxMs = 30_000) {
    return new Promise(resolve => {
        const t     = Date.now() + maxMs;
        const isSSL = url.startsWith('https');
        const lib   = isSSL ? https : http;
        const healthUrl = `${url.replace('/v1', '')}/api/health`;

        const go = () => lib.get(healthUrl, r => {
            if (r.statusCode === 200) { console.log(`[9Router] ✅ ${url}`); resolve(true); }
            else retry();
        }).on('error', retry);
        const retry = () => Date.now() < t ? setTimeout(go, 1500) : resolve(false);
        go();
    });
}

async function main() {
    console.log('═'.repeat(60));
    console.log('  HermesMoneyAgent v7.1 — Gateway Mode');
    console.log(`  Model   : ${HERMES_MODEL}`);
    console.log(`  Router  : ${NINEROUTER_URL} ${USE_EXTERNAL_ROUTER ? '(VPS/Remote)' : '(Local)'}`);
    console.log(`  Browser : CloakBrowser :9222`);
    console.log('═'.repeat(60));

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    // ── 1. 9Router config ──────────────────────────────────────────────────
    console.log('\n[1/6] 9Router config...');
    keyManager.generate9RouterConfig(dataDir);

    // ── 2. CloakBrowser watchdog ───────────────────────────────────────────
    console.log('[2/6] CloakBrowser watchdog...');
    await browserWatchdog.start();

    // ── 3. 9Router ────────────────────────────────────────────────────────
    let routerProcess = null;
    if (USE_EXTERNAL_ROUTER) {
        console.log(`[3/6] 9Router EXTERNAL: ${NINEROUTER_URL}`);
        console.log('      Menghubungkan ke VPS 9Router...');
        const ok = await waitForRouter(NINEROUTER_URL, 15_000);
        if (!ok) {
            console.warn('[9Router] ⚠ Tidak bisa reach VPS 9Router — lanjut tetap (Hermes akan coba)');
        }
    } else {
        console.log(`[3/6] 9Router LOCAL (port ${NINEROUTER_PORT})...`);
        routerProcess = spawn('npx',
            ['next', 'dev', '-p', String(NINEROUTER_PORT)],
            {
                env: Object.assign({}, process.env, {
                    PORT: String(NINEROUTER_PORT), DATA_DIR: dataDir,
                    HOSTNAME: '0.0.0.0',
                    NEXT_PUBLIC_BASE_URL: `http://127.0.0.1:${NINEROUTER_PORT}`,
                }),
                cwd: path.join(__dirname, '..', '9router'),
                stdio: 'pipe',
            }
        );
        routerProcess.stdout.on('data', d => {
            const m = d.toString().trim();
            if (/start|ready|listen|running/i.test(m)) console.log(`[9Router] ${m}`);
        });
        routerProcess.stderr.on('data', d => console.error(`[9Router ERR] ${d.toString().trim()}`));
        await waitForRouter(`http://127.0.0.1:${NINEROUTER_PORT}`);
    }

    // ── 4. Platform setup ────────────────────────────────────────────────
    console.log('\n[4/6] Auto-registrasi platform $0 modal...');
    if (!USER_EMAIL) {
        console.warn('[Setup] ⚠ PLATFORM_EMAIL belum diset. Lewati auto-setup.');
    } else {
        await platformSetup.runSetup(USER_EMAIL, USER_PASSWORD);
    }

    // ── 5. Telegram start notification ───────────────────────────────────
    console.log('\n[5/6] Telegram start notification...');
    const setupState  = platformSetup.state.registered;
    const readyList   = Object.entries(setupState)
        .filter(([, v]) => v.status === 'active')
        .map(([k]) => `✅ ${k}`)
        .join('\n') || '(setup via email diperlukan)';
    const pendingList = Object.entries(setupState)
        .filter(([, v]) => v.status !== 'active')
        .map(([k, v]) => `⏳ ${k}: ${v.status}`)
        .join('\n');

    await telegramNotifier.sendAlert(
        `🚀 *HermesMoneyAgent v7.1* aktif!\n\n` +
        `*Mode: Gateway* — kirim pesan langsung ke bot ini!\n` +
        `*Router: ${USE_EXTERNAL_ROUTER ? '🌐 VPS (' + NINEROUTER_URL + ')' : '💻 Lokal'}*\n` +
        `*Target:* $10 / 8 jam | Modal: $0\n\n` +
        `*Platform Siap:*\n${readyList}\n` +
        `${pendingList ? `\n*Menunggu Konfirmasi:*\n${pendingList}\n` : ''}\n` +
        `*Perintah yang bisa kamu kirim:*\n` +
        `• \`toloka ok\` — setelah login Toloka\n` +
        `• \`da ok\` — setelah verifikasi DataAnnotation\n` +
        `• \`outlier ok\` — setelah verifikasi Outlier AI\n` +
        `• \`fastwork ok\` — setelah login Fastwork.id\n` +
        `• \`status\` — laporan earning saat ini\n` +
        `• \`pause\` / \`resume\` — jeda dan lanjut\n` +
        `• \`ganti ke Textbroker\` — paksa pindah platform\n` +
        `• \`stop\` — hentikan agent\n\n` +
        `Agent mulai bekerja. Perintahmu diterima kapan saja via chat ini! 💪`
    );

    // ── 6. Spawn Hermes Gateway ───────────────────────────────────────────
    console.log('\n[6/6] Spawning Hermes Gateway...');
    const hermesDir  = path.join(__dirname, '..', 'hermes-agent');
    const hermesPy   = path.join(hermesDir, '..', 'venv', 'bin', 'python');
    const hermesCli  = path.join(hermesDir, 'cli.py');

    const hermesProcess = spawn(hermesPy,
        [
            hermesCli,
            '--gateway',
            '--query', INITIAL_PROMPT,
            '--model', 'kiro',
            '--provider', 'custom',
            '--base_url', `${NINEROUTER_URL}/v1`,
            '--api_key', NINEROUTER_KEY,
        ],
        {
            env: Object.assign({}, process.env, {
                OPENAI_BASE_URL: `${NINEROUTER_URL}/v1`,
                OPENAI_API_KEY:  NINEROUTER_KEY,
                TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
                TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   || '',
                CLOAK_CDP_URL:      browserWatchdog.CDP_URL,
                CLOAK_DEBUG_PORT:   '9222',
                PLATFORM_EMAIL:     USER_EMAIL,
                PLATFORM_PASSWORD:  USER_PASSWORD,
                HERMES_HOME:        process.env.HERMES_HOME || path.join(process.env.HOME || '', '.hermes'),
                HERMES_MODEL:       HERMES_MODEL,
            }),
            cwd: hermesDir,
            stdio: 'pipe',
        }
    );

    const log = fs.createWriteStream(path.join(logsDir, 'gateway.log'), { flags: 'a' });
    hermesProcess.stdout.on('data', d => { process.stdout.write(`[Hermes Gateway] ${d}`); log.write(d); });
    hermesProcess.stderr.on('data', d => { process.stderr.write(`[Hermes ERR] ${d}`); log.write(d); });
    hermesProcess.on('error', err => {
        console.error(`[Hermes] Gagal start: ${err.message}`);
        console.error('[Hermes] Jalankan setup dulu: bash scripts/hermes-money-setup.sh');
    });
    hermesProcess.on('exit', code => console.log(`[Hermes] Keluar (kode: ${code})`));

    const interval = setInterval(async () => {
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.checkPeriodicUpdate(
            parseFloat(r.sessionEarned.replace('$', ''))
        );
    }, 60_000);

    process.on('SIGINT', async () => {
        console.log('\n[Orchestrator] Shutdown...');
        clearInterval(interval);
        browserWatchdog.stop();
        routerProcess?.kill('SIGTERM');
        hermesProcess?.kill('SIGTERM');
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.sendAlert(
            `🛑 *Agent dihentikan*\n` +
            `💰 Earned: ${r.sessionEarned} / ${r.sessionTarget}\n` +
            `⚡ Rate: ${r.currentRatePerHour}/jam\n` +
            `📈 Proyeksi: ${r.projectedTotal}`
        );
        log.close();
        process.exit(0);
    });
}

main().catch(err => { console.error('[Orchestrator] Fatal:', err); process.exit(1); });
