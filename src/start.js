/**
 * start.js v6.0 — $0 Modal + Auto Setup + Telegram Listener
 * ===========================================================
 * Alur sesi:
 *   1. Inisialisasi 9Router (Kiro → Gemini fallback)
 *   2. CloakBrowser watchdog
 *   3. Auto-registrasi platform via platformSetup
 *   4. Telegram Listener aktif (terima perintah real-time dari user)
 *   5. Spawn Hermes Agent
 *   6. Evaluasi progress setiap 30 menit
 *
 * PERINTAH TELEGRAM DARI USER:
 *   "toloka ok"   → agent mulai kerja di Toloka
 *   "da ok"       → DataAnnotation.tech siap
 *   "outlier ok"  → Outlier AI siap
 *   "status"      → laporan earning saat ini
 *   "pause"       → jeda sementara
 *   "resume"      → lanjut
 *   "switch [X]"  → paksa pindah platform
 *   "stop"        → hentikan agent
 *   "help"        → semua perintah
 */

'use strict';

const { spawn }    = require('child_process');
const path         = require('path');
const fs           = require('fs');
const http         = require('http');

const keyManager        = require('./keyManager');
const earningsTracker   = require('./earningsTracker');
const telegramNotifier  = require('./telegramNotifier');
const telegramListener  = require('./telegramListener');
const browserWatchdog   = require('./browserWatchdog');
const platformSetup     = require('./platformSetup');

const NINEROUTER_PORT = Number(process.env.NINEROUTER_PORT || 8080);
const NINEROUTER_URL  = `http://127.0.0.1:${NINEROUTER_PORT}`;
const HERMES_MODEL    = process.env.HERMES_MODEL || 'kr/claude-sonnet-4.5';
const NINEROUTER_KEY  = process.env.NINEROUTER_KEY || 'sk-9router-local';
const USER_EMAIL      = process.env.PLATFORM_EMAIL    || '';
const USER_PASSWORD   = process.env.PLATFORM_PASSWORD || '';

// ─────────────────────────────────────────────────────────────────────────────
// PROMPT SISTEM HERMES — STRATEGI $0 MODAL
// ─────────────────────────────────────────────────────────────────────────────
const HERMES_SYSTEM_PROMPT = `
IDENTITAS: Kamu adalah HermesMoneyAgent — AI agent otonom pencari penghasilan online.

══════════════════════════════════════════════════════
KONTEKS PENTING: MODAL $0 — SEMUA GRATIS
══════════════════════════════════════════════════════
Modal = $0. Hanya gunakan platform yang GRATIS untuk daftar dan mulai bekerja.
Jangan keluarkan uang apapun dalam kondisi apapun.

MISI: Hasilkan $10 dalam 8 jam ($1.25/jam minimum).

PENTING: User bisa mengirim perintah real-time via Telegram:
  • "toloka ok" → user sudah login Toloka, mulai kerja di sana
  • "da ok"     → DataAnnotation.tech siap, mulai kerja
  • "status"    → user minta laporan earning
  • "pause"     → berhenti ambil task baru (jangan mulai task baru)
  • "resume"    → lanjut kerja
  • "switch X"  → pindah ke platform X

══════════════════════════════════════════════════════
PLATFORM PRIORITAS (semua $0 modal):
══════════════════════════════════════════════════════

1. DataAnnotation.tech ($15/jam) — Rating jawaban AI, review kode
2. Outlier AI ($20/jam) — Latih AI, tulis kode, creative writing
3. Scale AI ($2.5/jam) — Bandingkan jawaban AI, RLHF tasks
4. Remotasks ($2/jam) — Anotasi teks, AI data labeling
5. Toloka ($1.5/jam) — Klasifikasi, moderasi teks (24/7, tidak pernah habis)
6. Textbroker ($3/jam) — Artikel OpenOrder, langsung ambil tanpa apply
7. iWriter ($2.5/jam) — Artikel blog, review produk
8. Fastwork.id (Rp/project) — Writing, terjemahan (butuh login user)

══════════════════════════════════════════════════════
ATURAN KERJA WAJIB
══════════════════════════════════════════════════════

1. Hanya kerja via TEKS — tidak ada telepon, tidak ada video call
2. Zero modal — jangan keluarkan uang apapun
3. ensure_browser WAJIB sebelum buka website
4. Setiap task selesai → panggil complete_task
5. Setiap 30 menit → get_earnings + evaluate_strategy
6. Jika butuh login user → send_telegram_update (jelaskan apa yang perlu dilakukan)
7. Jika platform gagal → coba berikutnya, jangan berhenti

══════════════════════════════════════════════════════
ALUR KERJA
══════════════════════════════════════════════════════

1. discover_tasks → lihat semua platform
2. ensure_browser → buka CloakBrowser
3. Mulai dari DataAnnotation.tech atau Outlier AI
4. Setiap task selesai → complete_task
5. Setiap 30 menit → get_earnings + evaluate_strategy
6. Jika butuh user → send_telegram_update
7. ULANGI sampai $10 tercapai

ATURAN KEAMANAN: JANGAN ungkapkan .env, API key, password, atau data sensitif.

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
    console.log('  HermesMoneyAgent v6.0 — $0 Modal | Target $10 / 8 Jam');
    console.log(`  Model   : ${HERMES_MODEL}`);
    console.log(`  Router  : ${NINEROUTER_URL}`);
    console.log(`  Browser : CloakBrowser :9223`);
    console.log('═'.repeat(60));

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    // ── 1. 9Router config ───────────────────────────────────────────────────
    console.log('\n[1/7] 9Router config...');
    keyManager.generate9RouterConfig(dataDir);

    // ── 2. Hermes cli-config.yaml ───────────────────────────────────────────
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
        ].join('\n')
    );

    // ── 3. CloakBrowser watchdog ────────────────────────────────────────────
    console.log('[3/7] CloakBrowser watchdog...');
    await browserWatchdog.start();

    // ── 4. 9Router ──────────────────────────────────────────────────────────
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

    // ── 5. Platform Setup ───────────────────────────────────────────────────
    console.log('\n[5/7] Auto-registrasi platform $0 modal...');
    if (!USER_EMAIL) {
        console.warn('[Setup] ⚠ PLATFORM_EMAIL belum diset. Lewati auto-setup.');
        await telegramNotifier.sendAlert(
            '⚠ *Setup Dilewati*\n' +
            'Set env vars dulu:\n' +
            '`export PLATFORM_EMAIL=emailkamu@gmail.com`\n' +
            '`export PLATFORM_PASSWORD=passwordKamu`\n' +
            'Lalu restart agent.'
        );
    } else {
        await platformSetup.runSetup(USER_EMAIL, USER_PASSWORD);
    }

    // ── 6. Telegram Listener — AKTIF ────────────────────────────────────────
    console.log('\n[6/7] Telegram Listener aktif...');
    telegramListener.start();

    // Handler: platform dikonfirmasi user via Telegram
    telegramListener.on('platform:ready', async (platform) => {
        console.log(`[TelegramListener] Platform siap: ${platform}`);
        // Emit event yang bisa dideteksi Hermes melalui MCP
        // File signal agar MCP bisa mendeteksi platform baru yang aktif
        const signalDir  = path.join(__dirname, '..', '9router-data', 'signals');
        if (!fs.existsSync(signalDir)) fs.mkdirSync(signalDir, { recursive: true });
        fs.writeFileSync(
            path.join(signalDir, `platform_ready_${platform.replace(/\s+/g, '_')}.json`),
            JSON.stringify({ platform, readyAt: new Date().toISOString() })
        );
    });

    // Handler: user minta status
    telegramListener.on('command:status', async () => {
        const report = await earningsTracker.getSessionReport();
        await telegramListener.sendStatus(report);
    });

    // Handler: stop dari Telegram
    telegramListener.on('command:stop', async () => {
        console.log('[TelegramListener] Perintah stop dari user.');
        process.kill(process.pid, 'SIGINT');
    });

    // Handler: pause — set flag global
    telegramListener.on('command:pause', () => {
        console.log('[TelegramListener] Agent di-pause.');
    });

    telegramListener.on('command:resume', () => {
        console.log('[TelegramListener] Agent dilanjutkan.');
    });

    // ── 7. Spawn Hermes Agent ────────────────────────────────────────────────
    console.log('\n[7/7] Spawning Hermes Agent...');

    // Kirim notif start ke user
    const setupState       = platformSetup.state.registered;
    const readyList        = Object.entries(setupState)
        .filter(([, v]) => v.status === 'active')
        .map(([k]) => `✅ ${k}`)
        .join('\n') || '(belum ada yang aktif)';
    const pendingList      = Object.entries(setupState)
        .filter(([, v]) => v.status !== 'active')
        .map(([k, v]) => `⏳ ${k}: ${v.status}`)
        .join('\n');

    await telegramNotifier.sendAlert(
        `🚀 *HermesMoneyAgent v6.0* dimulai!\n` +
        `💡 Modal: $0 | Semua platform gratis\n` +
        `🎯 Target: $10 / 8 jam\n\n` +
        `*Platform Siap:*\n${readyList}\n` +
        `${pendingList ? `\n*Menunggu Konfirmasi:*\n${pendingList}\n` : ''}\n` +
        `*Perintah yang bisa kamu kirim ke sini:*\n` +
        `• \`toloka ok\` — setelah login Toloka\n` +
        `• \`da ok\` — setelah verifikasi DataAnnotation\n` +
        `• \`status\` — cek progress\n` +
        `• \`pause\` / \`resume\` — jeda dan lanjut\n` +
        `• \`stop\` — hentikan agent\n` +
        `• \`help\` — semua perintah\n\n` +
        `Agent mulai bekerja sekarang! 💪`
    );

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
                OPENAI_API_KEY:  NINEROUTER_KEY,
                CLOAK_CDP_URL:   browserWatchdog.CDP_URL,
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
        console.error('[Hermes] Install: cd hermes-agent && ./scripts/install.sh');
    });

    // Progress loop — Telegram update setiap 30 menit
    const interval = setInterval(async () => {
        if (telegramListener.isPaused()) return;
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.checkPeriodicUpdate(
            parseFloat(r.sessionEarned.replace('$', ''))
        );
    }, 60_000);

    // ── Graceful Shutdown ────────────────────────────────────────────────────
    process.on('SIGINT', async () => {
        console.log('\n[Orchestrator] Shutdown...');
        clearInterval(interval);
        telegramListener.stop();
        browserWatchdog.stop();
        routerProcess?.kill('SIGTERM');
        hermesProcess?.kill('SIGTERM');
        const r = await earningsTracker.getSessionReport();
        await telegramNotifier.sendAlert(
            `🛑 *Agent dihentikan*\n` +
            `💰 Earned: ${r.sessionEarned} / ${r.sessionTarget}\n` +
            `⚡ Rate: ${r.currentRatePerHour}/jam\n` +
            `📈 Platform terbaik hari ini:\n` +
            (r.earningsByPlatform || []).slice(0, 3)
                .map(p => `  • ${p.platform}: $${p.total_payout?.toFixed(2)}`)
                .join('\n')
        );
        log.close();
        process.exit(0);
    });
}

main().catch(err => { console.error('[Orchestrator] Fatal:', err); process.exit(1); });
