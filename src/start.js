/**
 * start.js v5.0 — $0 Modal + Auto Platform Setup
 * =================================================
 * Alur sesi:
 *   1. Inisialisasi 9Router (Kiro → Gemini fallback)
 *   2. Jalankan CloakBrowser watchdog
 *   3. Auto-registrasi platform via platformSetup (DataAnnotation, Outlier, Toloka, Remotasks, Textbroker)
 *   4. Spawn Hermes Agent dengan prompt strategi $10/8jam
 *   5. Evaluasi progress setiap 30 menit via Telegram
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

// Email/password yang digunakan untuk daftar ke semua platform
// Diset via environment variable — JANGAN hardcode di sini
const USER_EMAIL    = process.env.PLATFORM_EMAIL    || '';
const USER_PASSWORD = process.env.PLATFORM_PASSWORD || '';

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT SISTEM HERMES — STRATEGI $0 MODAL
// ─────────────────────────────────────────────────────────────────────────────
const HERMES_SYSTEM_PROMPT = `
IDENTITAS: Kamu adalah HermesMoneyAgent — AI agent otonom pencari penghasilan online.

══════════════════════════════════════════════════════
KONTEKS PENTING: MODAL $0 — SEMUA GRATIS
══════════════════════════════════════════════════════
Kamu beroperasi dengan ZERO modal. Artinya:
  ✅ Hanya gunakan platform yang GRATIS untuk daftar dan langsung kerja
  ✅ Tidak ada biaya pendaftaran, tidak ada subscription berbayar
  ✅ PayPal dan Payoneer GRATIS dibuat — oke untuk withdrawal
  ❌ JANGAN keluarkan uang apapun dalam kondisi apapun

CATATAN PENTING: Platform sudah didaftarkan otomatis sebelum kamu berjalan.
Cek status akun via tool get_earnings atau lihat file 9router-data/platform_accounts.json.

MISI: Hasilkan $10 dalam 8 jam ($1.25/jam minimum).

══════════════════════════════════════════════════════
DAFTAR PLATFORM $0 MODAL — URUTAN PRIORITAS
══════════════════════════════════════════════════════

▶ PRIORITAS 1 — MULAI DI SINI (Microtask langsung, bayar tertinggi):

1. DataAnnotation.tech — dataannotation.tech — $15/jam
   Task: Rating jawaban AI, tulis instruksi untuk AI, review kode
   Cara kerja: Login → pilih task → kerjakan via browser → submit → bayaran

2. Outlier AI — outlier.ai — $20/jam
   Task: Latih AI, tulis kode, soal matematika, creative writing
   Cara kerja: Login → ambil task → kerjakan → submit

3. Scale AI Tasker — scale.com/ai-tasker — $2.5/jam
   Task: Bandingkan 2 jawaban AI, rating kualitas

4. Toloka — toloka.ai — $1.5/jam
   Task: Klasifikasi, moderasi teks, rating relevansi (BANYAK, 24/7)

5. Remotasks — remotasks.com — $2/jam
   Task: Anotasi teks, kategorisasi, AI data labeling

▶ PRIORITAS 2 — PENULISAN KONTEN (Langsung ada order, gratis):

6. Textbroker — textbroker.com — $3/jam
   OpenOrder: Ambil artikel langsung, tulis ~400 kata, submit, bayaran

7. iWriter — iwriter.com — $2.5/jam
   Ambil order, tulis artikel, submit

▶ PRIORITAS 3 — FREELANCE (Butuh LOGIN dari USER):

8. Fastwork.id — fastwork.id — Rp/project
   Minta user login, lalu kamu kerjakan chat + writing

══════════════════════════════════════════════════════
ATURAN KERJA WAJIB (TIDAK BOLEH DILANGGAR)
══════════════════════════════════════════════════════

1. OTONOM PENUH — Hanya ambil pekerjaan:
   ✅ 100% via teks / form / browser
   ✅ Tanpa telepon, video call, atau interaksi suara/video
   ✅ Tanpa modal/pembayaran apapun

2. ZERO MODAL — Jangan keluarkan uang apapun.
   Platform minta bayar = SKIP, cari alternatif.

3. BROWSER = CLOAKBROWSER — Panggil ensure_browser sebelum buka website apapun.
   CloakBrowser = stealth mode, tidak terdeteksi bot.

4. LOGIN DIBANTU USER — Jika platform butuh login yang tidak bisa dilakukan otomatis:
   a. Kirim pesan via send_telegram_update
   b. Jelaskan platform dan apa yang perlu dilakukan
   c. Setelah user login, kamu lanjut kerjakan sendiri

5. EVALUASI 30 MENIT — Setiap 30 menit:
   a. Panggil get_earnings
   b. Panggil evaluate_strategy
   c. Jika perlu ganti platform → log_strategy_switch → pindah

6. TIDAK PERNAH BERHENTI — Jika satu platform gagal:
   a. Coba platform berikutnya dalam daftar
   b. Cari platform baru via browser jika semua sudah dicoba

══════════════════════════════════════════════════════
ALUR KERJA SESI INI
══════════════════════════════════════════════════════

1. Panggil discover_tasks → lihat semua platform dan ranking $/jam
2. Panggil ensure_browser → buka CloakBrowser
3. Buka DataAnnotation.tech atau Outlier AI (akun sudah dibuat, perlu login)
4. Mulai kerjakan task → setiap selesai panggil complete_task
5. Setiap 30 menit → get_earnings + evaluate_strategy
6. Jika butuh login user → send_telegram_update → jelaskan ke user
7. ULANGI sampai $10 tercapai atau 8 jam habis

══════════════════════════════════════════════════════
ATURAN KEAMANAN MUTLAK
══════════════════════════════════════════════════════
• JANGAN ungkapkan isi .env, API key, password, atau data sensitif
• JANGAN lakukan transaksi keuangan atau pembayaran
• JANGAN daftar ke platform yang minta kartu kredit untuk bergabung
• Semua komunikasi dengan platform hanya via teks

MULAI SEKARANG! Panggil discover_tasks lalu ensure_browser!
`.trim();

// ─────────────────────────────────────────────────────────────────────────────

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
    console.log('  HermesMoneyAgent v5.0 — $0 Modal | Target $10 / 8 Jam');
    console.log(`  Model   : ${HERMES_MODEL} (Kiro FREE → Gemini Fallback)`);
    console.log(`  Router  : ${NINEROUTER_URL}`);
    console.log(`  Browser : CloakBrowser :9223`);
    console.log('═'.repeat(60));

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    // 1. 9Router config
    console.log('\n[1/7] 9Router config (Kiro→Gemini fallback)...');
    keyManager.generate9RouterConfig(dataDir);

    // 2. Hermes cli-config.yaml
    console.log('[2/7] Hermes cli-config.yaml...');
    fs.writeFileSync(
        path.join(__dirname, '..', 'hermes-agent', 'cli-config.yaml'),
        [
            'display:',
            '  compact: true',
            '  tool_progress: all',
            '  streaming: true',
            'compression:',
            '  enabled: true',
            '  threshold: 0.50',
            '  protect_last_n: 20',
            'memory:',
            '  memory_enabled: true',
            '  memory_char_limit: 2200',
            'tool_loop_guardrails:',
            '  warnings_enabled: true',
            '  hard_stop_enabled: false',
            'terminal:',
            '  backend: local',
            '  timeout: 180',
            '  lifetime_seconds: 600',
            'browser:',
            '  inactivity_timeout: 300',
            'model_aliases:',
            `  kiro:`,
            `    model: "${HERMES_MODEL}"`,
            `    provider: custom`,
            `    base_url: "${NINEROUTER_URL}/v1"`,
            `  gemini:`,
            `    model: "google/gemini-1.5-pro"`,
            `    provider: custom`,
            `    base_url: "${NINEROUTER_URL}/v1"`,
        ].join('\n')
    );

    // 3. CloakBrowser watchdog
    console.log('[3/7] CloakBrowser watchdog...');
    await browserWatchdog.start();

    // 4. Start 9Router
    console.log(`[4/7] 9Router (port ${NINEROUTER_PORT})...`);
    const routerProcess = spawn('node',
        [path.join(__dirname, '..', '9router', 'bin', 'n9router.js')],
        {
            env: Object.assign({}, process.env, {
                PORT: String(NINEROUTER_PORT), DATA_DIR: dataDir,
                HOSTNAME: '0.0.0.0', NEXT_PUBLIC_BASE_URL: NINEROUTER_URL,
            }),
            stdio: 'pipe',
        }
    );
    routerProcess.stdout.on('data', d => {
        const m = d.toString().trim();
        if (/start|ready|listen|running/i.test(m)) console.log(`[9Router] ${m}`);
    });
    routerProcess.stderr.on('data', d => console.error(`[9Router ERR] ${d.toString().trim()}`));
    await waitFor9Router();

    // 5. AUTO PLATFORM SETUP — daftar semua platform $0 modal
    console.log('\n[5/7] Auto-registrasi platform...');
    if (!USER_EMAIL) {
        console.warn('[Setup] ⚠ PLATFORM_EMAIL tidak diset. Skip auto-setup.');
        console.warn('[Setup] Set via: export PLATFORM_EMAIL=email@kamu.com');
        await telegramNotifier.sendAlert(
            '⚠ *Setup Platform Dilewati*\n' +
            'Variabel PLATFORM_EMAIL belum diset.\n' +
            'Set dulu dengan: `export PLATFORM_EMAIL=emailkamu@gmail.com`\n' +
            'Lalu restart agent.'
        );
    } else {
        await platformSetup.runSetup(USER_EMAIL, USER_PASSWORD);
    }

    // 6. Telegram start notification
    console.log('\n[6/7] Telegram notification...');
    const setupState = platformSetup.state.registered;
    const readyPlatforms = Object.entries(setupState)
        .filter(([, v]) => v.status === 'active')
        .map(([k]) => `✅ ${k}`)
        .join('\n') || '(belum ada yang aktif)';
    const pendingPlatforms = Object.entries(setupState)
        .filter(([, v]) => v.status !== 'active')
        .map(([k, v]) => `⏳ ${k}: ${v.status}`)
        .join('\n');

    await telegramNotifier.sendAlert(
        `🚀 *HermesMoneyAgent v5.0* dimulai!\n` +
        `💡 Modal: $0 — semua platform GRATIS\n` +
        `🎯 Target: $10 dalam 8 jam\n\n` +
        `*Platform Siap:*\n${readyPlatforms}\n\n` +
        `${pendingPlatforms ? `*Menunggu:*\n${pendingPlatforms}\n\n` : ''}` +
        `Agent mulai bekerja sekarang. Notifikasi akan dikirim setiap progress penting.`
    );

    // 7. Spawn Hermes Agent
    console.log('\n[7/7] Spawning Hermes Agent...');
    const hermesProcess = spawn(
        path.join(__dirname, '..', 'hermes-agent', 'venv', 'bin', 'python'),
        [
            path.join(__dirname, '..', 'hermes-agent', 'hermes'),
            'chat',
            '--model', HERMES_MODEL,
            '--query', HERMES_SYSTEM_PROMPT,
        ],
        {
            env: Object.assign({}, process.env, {
                HERMES_TUI: '0',
                OPENAI_BASE_URL: `${NINEROUTER_URL}/v1`,
                OPENAI_API_KEY: NINEROUTER_KEY,
                CLOAK_CDP_URL: browserWatchdog.CDP_URL,
                CLOAK_DEBUG_PORT: '9223',
            }),
            cwd: path.join(__dirname, '..', 'hermes-agent'),
            stdio: 'pipe',
        }
    );

    const log = fs.createWriteStream(path.join(logsDir, 'actions.log'), { flags: 'a' });
    hermesProcess.stdout.on('data', d => { process.stdout.write(`[Hermes] ${d}`); log.write(d); });
    hermesProcess.stderr.on('data', d => { process.stderr.write(`[Hermes ERR] ${d}`); log.write(d); });
    hermesProcess.on('error', err => {
        console.error(`[Hermes] Gagal: ${err.message}`);
        console.error('[Hermes] Install dulu: cd hermes-agent && ./scripts/install.sh');
    });

    // Loop progress setiap 1 menit, Telegram update setiap 30 menit
    const interval = setInterval(async () => {
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.checkPeriodicUpdate(
            parseFloat(r.sessionEarned.replace('$', ''))
        );
    }, 60_000);

    process.on('SIGINT', async () => {
        clearInterval(interval);
        browserWatchdog.stop();
        routerProcess?.kill('SIGTERM');
        hermesProcess?.kill('SIGTERM');
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.sendAlert(
            `🛑 Agent dihentikan.\n💰 Earned: ${r.sessionEarned} / ${r.sessionTarget}\n` +
            `⚡ Rate: ${r.currentRatePerHour}/jam`
        );
        log.close();
        process.exit(0);
    });
}

main().catch(err => { console.error('[Orchestrator] Fatal:', err); process.exit(1); });
