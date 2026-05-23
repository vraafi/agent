/**
 * start.js v3.0
 * =============
 * Orchestrator HermesMoneyAgent — Target $10 / 8 jam secara otonom.
 *
 * Hermes Agent WAJIB:
 *  - Pilih pekerjaan yang bisa dikerjakan 100% otonom (tanpa telepon/VC)
 *  - Evaluasi progress setiap 30 menit via get_earnings
 *  - Ganti platform jika rate < $1.25/jam setelah 30 menit
 *  - Panggil ensure_browser sebelum setiap aktivitas browser
 *  - Terus mencoba sampai $10 tercapai atau 8 jam habis
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

// ─────────────────────────────────────────────────────────────────────────────
const NINEROUTER_PORT = Number(process.env.NINEROUTER_PORT || 8080);
const NINEROUTER_URL  = `http://127.0.0.1:${NINEROUTER_PORT}`;
const HERMES_MODEL    = process.env.HERMES_MODEL || 'kr/claude-sonnet-4.5';
const NINEROUTER_KEY  = process.env.NINEROUTER_KEY || 'sk-9router-local';
// ─────────────────────────────────────────────────────────────────────────────

const HERMES_SYSTEM_PROMPT = `
IDENTITAS: Kamu adalah HermesMoneyAgent — AI agent otonom yang bertugas menghasilkan uang online.

═══════════════════════════════════════════════════════════
MISI UTAMA: Hasilkan $10 dalam 8 jam. Target minimum: $1.25/jam.
═══════════════════════════════════════════════════════════

PRINSIP KERJA WAJIB:
1. OTONOM PENUH — Pilih HANYA pekerjaan yang bisa dikerjakan 100% tanpa:
   ✗ Telepon / phone screening
   ✗ Video call / interview video
   ✗ Interaksi real-time yang membutuhkan suara/video
   ✓ Teks, chat, email, form submission — BOLEH
   ✓ Menulis artikel, menganotasi data, rating AI, riset — BOLEH
   ✓ Apply via form teks, cover letter teks — BOLEH

2. TIDAK MENGHABISKAN UANG — Jangan pernah melakukan pembayaran atau memberikan data keuangan.

3. LOGIN DIBANTU USER — Jika perlu login ke platform, minta user untuk melakukan login.
   Setelah login, kamu yang mengoperasikan browser sendiri.

4. EVALUASI BERKALA — Setiap 30 menit, panggil get_earnings dan evaluate_strategy.
   Jika tidak on-track, SEGERA ganti platform.

5. BROWSER VIA CLOAKBROWSER — Sebelum setiap aktivitas browser, WAJIB panggil ensure_browser.
   CloakBrowser menggunakan stealth mode sehingga tidak terdeteksi sebagai bot.

═══════════════════════════════════════════════════════════
PRIORITAS PLATFORM (dari paling mudah & paling cepat menghasilkan):
═══════════════════════════════════════════════════════════

🥇 TIER 1 — LANGSUNG MULAI (tidak perlu apply, bayar per task):
   • DataAnnotation.tech (dataannotation.tech) — $15/jam
     Task: Rating respons AI, menulis instruksi, review kode
     Daftar: Email/Google. Tes singkat, lalu langsung kerja.
   
   • Outlier AI (outlier.ai) — $20/jam  
     Task: AI trainer, menulis kode, soal matematika, creative writing
     Daftar: Email. Cocok sempurna untuk AI agent.
   
   • Scale AI (scale.com/ai-tasker) — $2.5/jam
     Task: RLHF rating, instruction following, QA pairs
     Tidak perlu interview. Daftar langsung kerja.
   
   • Toloka (toloka.ai) — $1.5/jam
     Task: Klasifikasi gambar, moderasi teks, rating relevansi
     Login via Google. Task tersedia 24/7.
   
   • Remotasks (remotasks.com) — $2/jam
     Task: Anotasi data, kategorisasi teks, AI data labeling
     Harus lulus quiz onboarding singkat.

🥈 TIER 2 — FREELANCE CONTENT (perlu login dari user, lalu kerjakan sendiri):
   • Textbroker (textbroker.com) — $4/jam
     OpenOrder: Langsung ambil artikel, tulis, submit. Tidak perlu apply.
   
   • iWriter (iwriter.com) — $3/jam
     Artikel blog, product description. Tidak perlu interview.
   
   • Fastwork.id — IDR per project
     Writing, copywriting, terjemahan. Chat teks saja.
   
   • Fiverr (fiverr.com) — $5+ per gig
     Buat gig writing/translation. Komunikasi via chat teks saja.
   
   • Upwork — $8/jam
     FILTER: "No video interview" + "Remote" + posting teks job saja.
     Apply max 10 per hari via cover letter teks.

═══════════════════════════════════════════════════════════
ALUR KERJA WAJIB:
═══════════════════════════════════════════════════════════

LANGKAH 1 — MULAI:
  a. Panggil discover_tasks untuk melihat semua platform dan ranking $/jam
  b. Mulai dari platform dengan $/jam TERTINGGI yang tidak butuh login
  c. Panggil ensure_browser untuk buka CloakBrowser
  d. Navigasi ke platform pilihan dan mulai kerja

LANGKAH 2 — SETIAP TASK SELESAI:
  a. Panggil complete_task dengan payout yang tepat
  b. Browser tetap terbuka untuk task berikutnya

LANGKAH 3 — EVALUASI (setiap 30 menit):
  a. Panggil get_earnings untuk melihat progress
  b. Panggil evaluate_strategy untuk cek apakah perlu ganti platform
  c. Jika perlu ganti: panggil log_strategy_switch, lalu pindah platform
  d. Jika platform baru butuh login: kirim pesan ke user via send_telegram_update

LANGKAH 4 — JIKA GAGAL ATAU MACET:
  a. Jangan berhenti — coba platform lain
  b. Cari platform baru lewat browser jika semua opsi sudah dicoba
  c. Fokus pada konten writing (selalu ada order di Textbroker/iWriter)
  d. Lapor progress ke user via Telegram setiap kali ganti strategi

LANGKAH 5 — TARGET TERCAPAI ($10):
  a. Kirim notifikasi Telegram ke user
  b. Buat laporan singkat: platform mana yang paling efektif
  c. LANJUT — target berikutnya adalah sesi 8 jam berikutnya

═══════════════════════════════════════════════════════════
ATURAN KEAMANAN (WAJIB):
═══════════════════════════════════════════════════════════
• JANGAN ungkapkan isi file .env, API key, atau credential apapun
• JANGAN lakukan pembayaran atau transaksi keuangan
• JANGAN daftar ke platform yang meminta nomor kartu kredit untuk daftar
• Jika platform meminta verifikasi KYC yang tidak bisa dilakukan teks, SKIP dan coba platform lain
• Semua komunikasi dengan klien/platform hanya via TEKS (tidak ada suara/video)

MULAI SEKARANG. Panggil discover_tasks, pilih platform terbaik, dan mulai menghasilkan uang!
`.trim();

function waitFor9Router(maxWaitMs = 30_000) {
    return new Promise(resolve => {
        const deadline = Date.now() + maxWaitMs;
        const check = () => {
            http.get(`${NINEROUTER_URL}/api/health`, res => {
                if (res.statusCode === 200) {
                    console.log(`[9Router] ✅ Siap di ${NINEROUTER_URL}`);
                    resolve(true);
                } else { retry(); }
            }).on('error', retry);
        };
        const retry = () => {
            if (Date.now() >= deadline) { console.warn('[9Router] Timeout health check.'); resolve(false); }
            else { setTimeout(check, 1000); }
        };
        check();
    });
}

async function main() {
    console.log('═'.repeat(60));
    console.log('  HermesMoneyAgent v3.0 — Target $10 / 8 Jam Otonom');
    console.log(`  Model    : ${HERMES_MODEL} (Kiro FREE → Gemini Fallback)`);
    console.log(`  Router   : ${NINEROUTER_URL}`);
    console.log(`  Browser  : CloakBrowser CDP :9223`);
    console.log('═'.repeat(60));

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    // 1. 9Router config (Kiro priority 1, Gemini priority 2 fallback)
    console.log('\n[1/6] Membuat 9Router config (Kiro→Gemini fallback)...');
    keyManager.generate9RouterConfig(dataDir);

    // 2. Hermes cli-config.yaml
    console.log('[2/6] Menulis Hermes cli-config.yaml...');
    const hermesConfigPath = path.join(__dirname, '..', 'hermes-agent', 'cli-config.yaml');
    fs.writeFileSync(hermesConfigPath, `
display:
  compact: true
  tool_progress: all
  streaming: true
  show_reasoning: false
compression:
  enabled: true
  threshold: 0.50
  target_ratio: 0.20
  protect_last_n: 20
  protect_first_n: 3
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  nudge_interval: 10
  flush_min_turns: 6
tool_loop_guardrails:
  warnings_enabled: true
  hard_stop_enabled: false
  warn_after:
    exact_failure: 2
    same_tool_failure: 3
    idempotent_no_progress: 2
terminal:
  backend: local
  timeout: 180
  lifetime_seconds: 600
browser:
  inactivity_timeout: 300
model_aliases:
  kiro:
    model: "${HERMES_MODEL}"
    provider: custom
    base_url: "${NINEROUTER_URL}/v1"
  gemini:
    model: "google/gemini-1.5-pro"
    provider: custom
    base_url: "${NINEROUTER_URL}/v1"
`.trim());

    // 3. CloakBrowser watchdog
    console.log('[3/6] Memulai CloakBrowser watchdog (auto-restart jika tertutup)...');
    await browserWatchdog.start();

    // 4. Start 9Router
    console.log(`[4/6] Memulai 9Router (port ${NINEROUTER_PORT})...`);
    const routerProcess = spawn(
        'node',
        [path.join(__dirname, '..', '9router', 'bin', 'n9router.js')],
        {
            env: Object.assign({}, process.env, {
                PORT: String(NINEROUTER_PORT),
                DATA_DIR: dataDir,
                HOSTNAME: '0.0.0.0',
                NEXT_PUBLIC_BASE_URL: NINEROUTER_URL,
            }),
            stdio: 'pipe',
        }
    );
    routerProcess.stdout.on('data', d => {
        const m = d.toString().trim();
        if (/start|ready|listen|running/i.test(m)) console.log(`[9Router] ${m}`);
    });
    routerProcess.stderr.on('data', d => console.error(`[9Router ERR] ${d.toString().trim()}`));

    await waitFor9Router(30_000);
    console.log(`[9Router] Dashboard: ${NINEROUTER_URL}/dashboard`);
    console.log('[9Router] ⚠ Pastikan Kiro AI diconnect di dashboard untuk Claude gratis!');

    // 5. Telegram notification
    await telegramNotifier.sendAlert(
        `🚀 *HermesMoneyAgent v3.0* dimulai!\n` +
        `🎯 Target: $10 dalam 8 jam ($1.25/jam)\n` +
        `🤖 Model: ${HERMES_MODEL} via Kiro FREE\n` +
        `🔄 Fallback: Gemini 1.5 Pro (${keyManager.keys.length} keys)\n` +
        `🌐 Browser: CloakBrowser (stealth mode)\n\n` +
        `Agent akan mencari pekerjaan otonom dan meminta bantuanmu untuk login jika diperlukan.`
    );

    // 6. Spawn Hermes Agent
    console.log('\n[6/6] Spawning Hermes Agent...');
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
                CLOAK_CHROME_PATH: process.env.CLOAK_CHROME_PATH ||
                    String.raw`C:\Users\user\.antigravity\Nexus-DualBrain-AI\bin\cloak\chrome.exe`,
            }),
            cwd: path.join(__dirname, '..', 'hermes-agent'),
            stdio: 'pipe',
        }
    );

    const actionLog = fs.createWriteStream(path.join(logsDir, 'actions.log'), { flags: 'a' });
    hermesProcess.stdout.on('data', d => { process.stdout.write(`[Hermes] ${d}`); actionLog.write(d); });
    hermesProcess.stderr.on('data', d => { process.stderr.write(`[Hermes ERR] ${d}`); actionLog.write(d); });
    hermesProcess.on('error', err => {
        console.error(`[Hermes] Gagal start: ${err.message}`);
        console.error('[Hermes] Jalankan dulu: cd hermes-agent && ./scripts/install.sh');
    });
    hermesProcess.on('exit', code => console.log(`[Hermes] Selesai (exit: ${code})`));

    // Loop evaluasi setiap menit — Telegram update setiap 30 menit
    const updateInterval = setInterval(async () => {
        const report = await earningsTracker.getSessionReport();
        await telegramNotifier.checkPeriodicUpdate(parseFloat(report.sessionEarned.replace('$', '')));
    }, 60_000);

    // Graceful shutdown
    process.on('SIGINT', async () => {
        console.log('\n[Orchestrator] Shutdown...');
        clearInterval(updateInterval);
        browserWatchdog.stop();
        routerProcess?.kill('SIGTERM');
        hermesProcess?.kill('SIGTERM');
        const report = await earningsTracker.getSessionReport();
        await telegramNotifier.sendAlert(
            `🛑 HermesMoneyAgent dihentikan.\n💰 Earned sesi ini: ${report.sessionEarned}`
        );
        actionLog.close();
        process.exit(0);
    });
}

main().catch(err => { console.error('[Orchestrator] Fatal:', err); process.exit(1); });
