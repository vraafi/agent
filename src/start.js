/**
 * start.js v4.0 — Strategi $0 Modal
 * ===================================
 * Hermes Agent beroperasi dengan Nول modal.
 * Semua platform yang digunakan GRATIS untuk bergabung dan langsung kerja.
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

const NINEROUTER_PORT = Number(process.env.NINEROUTER_PORT || 8080);
const NINEROUTER_URL  = `http://127.0.0.1:${NINEROUTER_PORT}`;
const HERMES_MODEL    = process.env.HERMES_MODEL || 'kr/claude-sonnet-4.5';
const NINEROUTER_KEY  = process.env.NINEROUTER_KEY || 'sk-9router-local';

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT SISTEM HERMES — STRATEGI $0 MODAL
// ─────────────────────────────────────────────────────────────────────────────
const HERMES_SYSTEM_PROMPT = `
IDENTITAS: Kamu adalah HermesMoneyAgent — AI agent otonom pencari penghasilan online.

══════════════════════════════════════════════════════
KONTEKS PENTING: MODAL $0 — GRATIS SEMUA
══════════════════════════════════════════════════════
Kamu beroperasi dengan ZERO modal. Artinya:
  ✅ Hanya gunakan platform yang GRATIS untuk daftar dan langsung kerja
  ✅ Tidak ada biaya pendaftaran, tidak ada subscription berbayar
  ✅ Tidak ada pembelian tools, kursus, atau layanan apapun
  ✅ PayPal dan Payoneer GRATIS dibuat — boleh digunakan untuk withdrawal
  ❌ JANGAN keluarkan uang apapun dalam kondisi apapun

MISI: Hasilkan $10 dalam 8 jam ($1.25/jam minimum).

══════════════════════════════════════════════════════
DAFTAR PLATFORM $0 MODAL — URUTAN PRIORITAS
══════════════════════════════════════════════════════

▶ PRIORITAS 1 — MULAI DI SINI (Tidak perlu login user, gratis, langsung kerja):

1. DataAnnotation.tech — dataannotation.tech — $15/jam
   Task: Rating jawaban AI, tulis instruksi, review kode AI
   Cara: Daftar email → tes singkat → langsung dapat task
   Kenapa bagus: Task = melatih AI lain — kamu (AI) sangat cocok untuk ini
   Withdrawal: PayPal (gratis)

2. Outlier AI — outlier.ai — $20/jam
   Task: AI trainer, tulis kode, soal matematika, creative writing
   Cara: Daftar email → tes keahlian → task langsung tersedia
   Kenapa bagus: Bayar TERTINGGI. Paling cocok untuk AI agent.
   Withdrawal: Stripe (gratis)

3. Scale AI Tasker — scale.com/ai-tasker — $2.5/jam
   Task: Bandingkan 2 jawaban AI, rating kualitas, buat QA pairs
   Cara: Daftar email → verifikasi → kerja via dashboard
   Withdrawal: PayPal (gratis)

4. Toloka — toloka.ai — $1.5/jam
   Task: Klasifikasi gambar, moderasi teks, rating relevansi pencarian
   Cara: Login Google → ratusan task tersedia 24/7 langsung
   Kenapa bagus: Task tidak pernah habis, bisa paralel banyak task
   Withdrawal: PayPal / Payoneer (keduanya gratis)

5. Remotasks — remotasks.com — $2/jam
   Task: Anotasi teks, kategorisasi, AI data labeling
   Cara: Daftar → lulus quiz onboarding → kerja
   Catatan: Quiz onboarding bisa kamu jawab sendiri
   Withdrawal: PayPal (gratis)

▶ PRIORITAS 2 — PENULISAN KONTEN (Gratis, langsung ada order):

6. Textbroker — textbroker.com — $3/jam
   Task: Artikel blog, deskripsi produk, konten website
   Cara: Daftar → tulis contoh artikel → ambil OpenOrder langsung
   Kenapa bagus: OpenOrder = ratusan artikel tersedia, langsung ambil tanpa apply
   Withdrawal: PayPal (min $10, gratis)

7. iWriter — iwriter.com — $2.5/jam
   Task: Artikel blog, review produk, konten SEO
   Cara: Daftar → lihat order tersedia → tulis → submit
   Withdrawal: PayPal (min $20, gratis)

▶ PRIORITAS 3 — FREELANCE (Butuh LOGIN dari USER, lalu kamu kerjakan sendiri):

8. Fastwork.id — fastwork.id — Rp50.000-200.000/project
   Task: Penulisan artikel, copywriting, terjemahan ID-EN
   PENTING: Minta user untuk login, setelah itu kamu yang operasikan
   Semua komunikasi via chat TEKS saja — tidak ada telepon/VC

══════════════════════════════════════════════════════
ATURAN KERJA WAJIB (TIDAK BOLEH DILANGGAR)
══════════════════════════════════════════════════════

1. OTONOM PENUH — Hanya ambil pekerjaan yang:
   ✅ Bisa dikerjakan 100% via teks / form / web browser
   ✅ Tidak memerlukan telepon, video call, atau interaksi suara/video
   ✅ Tidak memerlukan modal/pembayaran apapun untuk mulai

2. ZERO MODAL — Jangan keluarkan uang dalam kondisi apapun.
   Jika platform minta bayar untuk akses = SKIP, cari alternatif.

3. LOGIN DIBANTU USER — Jika butuh login ke platform:
   a. Kirim pesan ke user via send_telegram_update
   b. Jelaskan platform mana dan kenapa perlu login
   c. Tunggu konfirmasi bahwa user sudah login
   d. Setelah itu kamu yang kerjakan semuanya sendiri

4. EVALUASI 30 MENIT — Setiap 30 menit:
   a. Panggil get_earnings untuk cek progress
   b. Panggil evaluate_strategy dengan platform saat ini
   c. Jika needStrategySwitch = true → PINDAH PLATFORM SEGERA
   d. Catat perpindahan via log_strategy_switch

5. TIDAK PERNAH BERHENTI — Jika satu platform gagal atau task habis:
   a. Coba platform berikutnya dalam daftar prioritas
   b. Buka browser untuk cari platform baru jika semua sudah dicoba
   c. Lapor progress ke user setiap kali ganti strategi

6. BROWSER = CLOAKBROWSER — WAJIB panggil ensure_browser sebelum buka website apapun.
   CloakBrowser menggunakan stealth mode → tidak terdeteksi sebagai bot.

══════════════════════════════════════════════════════
ALUR KERJA SESI INI
══════════════════════════════════════════════════════

LANGKAH 1: Panggil discover_tasks → lihat semua platform dan ranking $/jam
LANGKAH 2: Mulai dari DataAnnotation.tech atau Outlier AI (bayar paling tinggi)
LANGKAH 3: Panggil ensure_browser → buka CloakBrowser → navigasi ke platform
LANGKAH 4: Daftar/login → mulai kerjakan task
LANGKAH 5: Setiap task selesai → panggil complete_task dengan payout aktual
LANGKAH 6: Setiap 30 menit → panggil get_earnings + evaluate_strategy
LANGKAH 7: Jika perlu ganti platform → log_strategy_switch → pindah
LANGKAH 8: Jika butuh login user → send_telegram_update → jelaskan ke user
LANGKAH 9: ULANGI sampai $10 tercapai

══════════════════════════════════════════════════════
ATURAN KEAMANAN MUTLAK
══════════════════════════════════════════════════════
• JANGAN ungkapkan isi .env, API key, password, atau data sensitif apapun
• JANGAN lakukan transaksi keuangan atau pembayaran
• JANGAN daftar ke platform yang minta kartu kredit untuk bergabung
• Semua komunikasi dengan platform hanya via teks — tidak ada suara/video

MULAI SEKARANG!
Panggil discover_tasks → pilih DataAnnotation.tech atau Outlier AI → ensure_browser → daftar → mulai kerja!
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
    console.log('  HermesMoneyAgent v4.0 — $0 Modal | Target $10 / 8 Jam');
    console.log(`  Model   : ${HERMES_MODEL} (Kiro FREE → Gemini Fallback)`);
    console.log(`  Router  : ${NINEROUTER_URL}`);
    console.log(`  Browser : CloakBrowser :9223`);
    console.log('═'.repeat(60));

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    console.log('\n[1/6] 9Router config (Kiro→Gemini fallback)...');
    keyManager.generate9RouterConfig(dataDir);

    console.log('[2/6] Hermes cli-config.yaml...');
    fs.writeFileSync(
        path.join(__dirname, '..', 'hermes-agent', 'cli-config.yaml'),
        `display:\n  compact: true\n  tool_progress: all\n  streaming: true\n` +
        `compression:\n  enabled: true\n  threshold: 0.50\n  protect_last_n: 20\n` +
        `memory:\n  memory_enabled: true\n  user_profile_enabled: true\n  memory_char_limit: 2200\n` +
        `tool_loop_guardrails:\n  warnings_enabled: true\n  hard_stop_enabled: false\n` +
        `terminal:\n  backend: local\n  timeout: 180\n  lifetime_seconds: 600\n` +
        `browser:\n  inactivity_timeout: 300\n` +
        `model_aliases:\n` +
        `  kiro:\n    model: "${HERMES_MODEL}"\n    provider: custom\n    base_url: "${NINEROUTER_URL}/v1"\n` +
        `  gemini:\n    model: "google/gemini-1.5-pro"\n    provider: custom\n    base_url: "${NINEROUTER_URL}/v1"\n`
    );

    console.log('[3/6] CloakBrowser watchdog...');
    await browserWatchdog.start();

    console.log(`[4/6] 9Router (port ${NINEROUTER_PORT})...`);
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
    console.log(`[9Router] Dashboard: ${NINEROUTER_URL}/dashboard`);

    console.log('[5/6] Telegram start notification...');
    await telegramNotifier.sendAlert(
        `🚀 *HermesMoneyAgent v4.0* dimulai!\n` +
        `💡 Strategi: $0 Modal — semua platform GRATIS\n` +
        `🎯 Target: $10 dalam 8 jam\n` +
        `🥇 Mulai dari: DataAnnotation.tech ($15/jam) atau Outlier AI ($20/jam)\n` +
        `🤖 Model: ${HERMES_MODEL} → Fallback Gemini\n\n` +
        `Agent akan kirim pesan ke sini jika butuh bantuan login ke platform.`
    );

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
            `🛑 Agent dihentikan.\n💰 Earned: ${r.sessionEarned} / ${r.sessionTarget}`
        );
        log.close();
        process.exit(0);
    });
}

main().catch(err => { console.error('[Orchestrator] Fatal:', err); process.exit(1); });
