/**
 * start.js v7.0 — Gateway Mode + Hermes Native Telegram
 * =======================================================
 * Hermes berjalan dalam MODE GATEWAY — menerima pesan Telegram
 * secara langsung tanpa perlu telegramListener.js terpisah.
 *
 * Hermes sudah punya mekanisme ini BUILT-IN:
 *   ✅ Telegram gateway (terima & kirim pesan natively)
 *   ✅ busy_input_mode: steer — pesan masuk saat Hermes bekerja
 *      di-inject ke sesi SETELAH tool call berikutnya selesai
 *   ✅ hermes cron — cron job untuk evaluasi otomatis
 *   ✅ --deliver telegram — kirim hasil cron ke Telegram
 *
 * User bisa kirim perintah langsung ke bot Telegram:
 *   "toloka ok"     → Hermes tau Toloka siap, langsung mulai kerja di sana
 *   "status"        → Hermes panggil get_earnings dan kirim laporan
 *   "pause"         → Masuk antrian, Hermes baca setelah tool call selesai
 *   "ganti ke X"    → Hermes pindah platform
 */

'use strict';

const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');
const http         = require('http');

const keyManager       = require('./keyManager');
const earningsTracker  = require('./earningsTracker');
const telegramNotifier = require('./telegramNotifier');
const browserWatchdog  = require('./browserWatchdog');
const platformSetup    = require('./platformSetup');

const NINEROUTER_PORT = Number(process.env.NINEROUTER_PORT || 8080);
const NINEROUTER_URL  = `http://127.0.0.1:${NINEROUTER_PORT}`;
const HERMES_MODEL    = process.env.HERMES_MODEL || 'kr/claude-sonnet-4.5';
const NINEROUTER_KEY  = process.env.NINEROUTER_KEY || 'sk-9router-local';
const USER_EMAIL      = process.env.PLATFORM_EMAIL    || '';
const USER_PASSWORD   = process.env.PLATFORM_PASSWORD || '';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT — dikirim sebagai initial message ke Hermes Gateway
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
  "fastwork ok"   → User sudah login Fastwork.id (fastworker.id) → kamu mulai kerja di Fastwork.id
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
  8. Fastwork.id (IDR 75k+/project, ~$5) — penulisan artikel, translation, copywriting (platform Indonesia, mudah verifikasi, transfer bank lokal)

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

function waitFor9Router(maxMs = 30_000) {
    return new Promise(resolve => {
        const t = Date.now() + maxMs;
        const go = () => http.get(`${NINEROUTER_URL}/api/health`, r => {
            if (r.statusCode === 200) { console.log(`[9Router] ✅ ${NINEROUTER_URL}`); resolve(true); }
            else retry();
        }).on('error', retry);
        const retry = () => Date.now() < t ? setTimeout(go, 1000) : resolve(false);
        go();
    });
}

async function main() {
    console.log('═'.repeat(60));
    console.log('  HermesMoneyAgent v7.0 — Gateway Mode + Native Telegram');
    console.log(`  Model   : ${HERMES_MODEL}`);
    console.log(`  Router  : ${NINEROUTER_URL}`);
    console.log(`  Browser : CloakBrowser :9222`);
    console.log('═'.repeat(60));
    console.log('');
    console.log('  Hermes Gateway Mode:');
    console.log('  • Menerima pesan Telegram langsung (tidak butuh telegramListener.js)');
    console.log('  • busy_input_mode: steer — pesan masuk saat bekerja di-inject setelah tool call');
    console.log('  • Cron jobs aktif: evaluasi 30 menit, laporan harian, scan platform mingguan');
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
    console.log(`[3/6] 9Router (port ${NINEROUTER_PORT})...`);
    const routerProcess = spawn('npx',
        ['next', 'dev', '-p', String(NINEROUTER_PORT)],
        {
            env: Object.assign({}, process.env, {
                PORT: String(NINEROUTER_PORT), DATA_DIR: dataDir,
                HOSTNAME: '0.0.0.0', NEXT_PUBLIC_BASE_URL: NINEROUTER_URL,
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
    await waitFor9Router();

    // ── 4. Platform setup ────────────────────────────────────────────────
    console.log('\n[4/6] Auto-registrasi platform $0 modal...');
    if (!USER_EMAIL) {
        console.warn('[Setup] ⚠ PLATFORM_EMAIL belum diset. Lewati auto-setup.');
    } else {
        await platformSetup.runSetup(USER_EMAIL, USER_PASSWORD);
    }

    // ── 5. Kirim notifikasi start ke Telegram ────────────────────────────
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
        `🚀 *HermesMoneyAgent v7.0* aktif!\n\n` +
        `*Mode: Gateway* — kirim pesan langsung ke bot ini!\n` +
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

    // Hermes Gateway: --gateway flag mengaktifkan mode gateway (terima Telegram)
    // Kirim initial prompt via --query untuk sesi pertama
    const hermesProcess = spawn(hermesPy,
        [
            hermesCli,
            '--gateway',           // Aktifkan gateway mode (Telegram native)
            '--query', INITIAL_PROMPT,  // Prompt awal untuk sesi pertama
            '--model', 'kiro',
            '--provider', 'custom',
            '--base_url', `${NINEROUTER_URL}/v1`,
            '--api_key', NINEROUTER_KEY,
        ],
        {
            env: Object.assign({}, process.env, {
                // 9Router sebagai LLM backend
                OPENAI_BASE_URL: `${NINEROUTER_URL}/v1`,
                OPENAI_API_KEY:  NINEROUTER_KEY,
                // Telegram credentials (dibaca oleh Hermes gateway)
                TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
                TELEGRAM_CHAT_ID:   process.env.TELEGRAM_CHAT_ID   || '',
                // CloakBrowser
                CLOAK_CDP_URL:      browserWatchdog.CDP_URL,
                CLOAK_DEBUG_PORT:   '9222',
                // Platform credentials untuk setup
                PLATFORM_EMAIL:     USER_EMAIL,
                PLATFORM_PASSWORD:  USER_PASSWORD,
                // Hermes home
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
    hermesProcess.on('exit', code => {
        console.log(`[Hermes] Keluar (kode: ${code})`);
    });

    // Progress loop — backup Telegram update setiap 30 menit
    // (Hermes cron sudah handle ini, ini sebagai backup jika gateway restart)
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
