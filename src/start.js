/**
 * start.js
 * ========
 * Orchestrator utama HermesMoneyAgent.
 *
 * Urutan startup:
 *   1. Generate konfigurasi 9Router (Kiro FREE + 10 Gemini fallback)
 *   2. Tulis cli-config.yaml untuk Hermes Agent (format resmi NousResearch)
 *   3. Jalankan CloakBrowser watchdog (browser tetap hidup selamanya)
 *   4. Jalankan 9Router pada port NINEROUTER_PORT
 *   5. Kirim notifikasi Telegram start
 *   6. Spawn Hermes Agent dengan OPENAI_BASE_URL → 9Router
 *   7. Loop notifikasi Telegram setiap 30 menit
 *
 * Fallback model (otomatis via 9Router combo strategy):
 *   Kiro AI (kr/claude-sonnet-4.5) FREE → Gemini 1.5 Pro (10 key rotasi)
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
// KONFIGURASI
// ─────────────────────────────────────────────────────────────────────────────
const NINEROUTER_PORT = Number(process.env.NINEROUTER_PORT || 8080);
const NINEROUTER_URL  = `http://127.0.0.1:${NINEROUTER_PORT}`;

// Model utama: Kiro AI (FREE, unlimited, no API key)
// Fallback otomatis ke Gemini via 9Router jika Kiro tidak tersedia
const HERMES_MODEL    = process.env.HERMES_MODEL || 'kr/claude-sonnet-4.5';
const NINEROUTER_KEY  = process.env.NINEROUTER_KEY || 'sk-9router-local';
// ─────────────────────────────────────────────────────────────────────────────

/** Cek apakah 9Router sudah siap menerima request. */
function waitFor9Router(maxWaitMs = 30_000) {
    return new Promise(resolve => {
        const deadline = Date.now() + maxWaitMs;
        const check = () => {
            http.get(`${NINEROUTER_URL}/api/health`, res => {
                if (res.statusCode === 200) {
                    console.log(`[9Router] Siap di ${NINEROUTER_URL} (health OK)`);
                    resolve(true);
                } else {
                    retry();
                }
            }).on('error', retry);
        };
        const retry = () => {
            if (Date.now() >= deadline) {
                console.warn('[9Router] Timeout health check — melanjutkan...');
                resolve(false);
            } else {
                setTimeout(check, 1000);
            }
        };
        check();
    });
}

async function main() {
    console.log('═'.repeat(55));
    console.log('  HermesMoneyAgent Orchestrator');
    console.log(`  Model  : ${HERMES_MODEL} (Kiro FREE)`);
    console.log(`  Fallback: Gemini 1.5 Pro (${keyManager.keys.length} keys)`);
    console.log(`  Router : ${NINEROUTER_URL}`);
    console.log('═'.repeat(55));

    const dataDir = path.join(__dirname, '..', '9router-data');
    const logsDir = path.join(__dirname, '..', 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

    // ── 1. Generate 9Router config (Kiro priority 1, Gemini priority 2) ──────
    console.log('\n[Step 1] Membuat konfigurasi 9Router...');
    keyManager.generate9RouterConfig(dataDir);

    // ── 2. Tulis Hermes cli-config.yaml (format resmi NousResearch) ───────────
    console.log('[Step 2] Menulis Hermes cli-config.yaml...');
    const hermesConfigPath = path.join(
        __dirname, '..', 'hermes-agent', 'cli-config.yaml'
    );

    const hermesConfig = `# Auto-generated oleh HermesMoneyAgent orchestrator
# Model utama : ${HERMES_MODEL} via Kiro AI (FREE, no key)
# Fallback    : Gemini 1.5 Pro via 9Router (10 keys rotasi)
# Provider    : 9Router di ${NINEROUTER_URL}

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
  user_profile_enabled: false
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

# Terminal: Hermes bisa membuka terminal sendiri dan menjalankan
# perintah shell secara bebas di mesin lokal (backend: local).
terminal:
  backend: local
  timeout: 180
  lifetime_seconds: 600

# Browser: Hermes menggunakan CloakBrowser via CDP (port 9223).
# Hermes HARUS memanggil tool ensure_browser sebelum aktivitas browser.
browser:
  inactivity_timeout: 300

# Model alias — gunakan 'kiro' sebagai shorthand
model_aliases:
  kiro:
    model: "${HERMES_MODEL}"
    provider: custom
    base_url: "${NINEROUTER_URL}/v1"
  gemini:
    model: "google/gemini-1.5-pro"
    provider: custom
    base_url: "${NINEROUTER_URL}/v1"
`;

    fs.writeFileSync(hermesConfigPath, hermesConfig.trim());
    console.log(`[Step 2] Hermes config → ${hermesConfigPath}`);

    // ── 3. Jalankan CloakBrowser watchdog ────────────────────────────────────
    console.log('[Step 3] Memulai CloakBrowser watchdog...');
    console.log('         Browser akan otomatis restart jika tertutup.');
    await browserWatchdog.start();

    // ── 4. Jalankan 9Router ───────────────────────────────────────────────────
    console.log(`\n[Step 4] Memulai 9Router pada port ${NINEROUTER_PORT}...`);
    const routerEnv = Object.assign({}, process.env, {
        PORT: String(NINEROUTER_PORT),
        DATA_DIR: dataDir,
        HOSTNAME: '0.0.0.0',
        NEXT_PUBLIC_BASE_URL: NINEROUTER_URL,
    });

    const routerProcess = spawn(
        'node',
        [path.join(__dirname, '..', '9router', 'bin', 'n9router.js')],
        { env: routerEnv, stdio: 'pipe' }
    );

    routerProcess.stdout.on('data', data => {
        const msg = data.toString().trim();
        if (/start|ready|listen|running/i.test(msg)) {
            console.log(`[9Router] ${msg}`);
        }
    });
    routerProcess.stderr.on('data', data => {
        console.error(`[9Router ERR] ${data.toString().trim()}`);
    });
    routerProcess.on('error', err => {
        console.error(`[9Router] Gagal start: ${err.message}`);
    });

    // Tunggu 9Router siap (health check)
    await waitFor9Router(30_000);
    console.log(`[9Router] Dashboard: ${NINEROUTER_URL}/dashboard`);
    console.log(`[9Router] ⚠  Pastikan Kiro AI sudah diconnect di dashboard!`);
    console.log(`[9Router]    Jika Kiro belum connect, fallback ke Gemini otomatis.`);

    // ── 5. Notifikasi Telegram start ──────────────────────────────────────────
    await telegramNotifier.sendAlert(
        `🚀 *HermesMoneyAgent* dimulai!\n` +
        `Model: \`${HERMES_MODEL}\` (Kiro FREE)\n` +
        `Fallback: Gemini 1.5 Pro (${keyManager.keys.length} keys)\n` +
        `Router: ${NINEROUTER_URL}\n` +
        `Browser: CloakBrowser CDP :9223`
    );

    // ── 6. Spawn Hermes Agent ─────────────────────────────────────────────────
    console.log('\n[Step 6] Spawning Hermes Agent...');

    const hermesEnv = Object.assign({}, process.env, {
        HERMES_TUI: '0',
        // 9Router sebagai OpenAI-compatible provider
        OPENAI_BASE_URL: `${NINEROUTER_URL}/v1`,
        OPENAI_API_KEY: NINEROUTER_KEY,
        // CloakBrowser CDP URL (Hermes bisa buka browser kapan saja)
        CLOAK_CDP_URL: browserWatchdog.CDP_URL,
        CLOAK_DEBUG_PORT: '9223',
    });

    const hermesProcess = spawn(
        path.join(__dirname, '..', 'hermes-agent', 'venv', 'bin', 'python'),
        [
            path.join(__dirname, '..', 'hermes-agent', 'hermes'),
            'chat',
            '--model', HERMES_MODEL,
            '--query', (
                'INSTRUKSI UTAMA:\n' +
                '1. Sebelum membuka browser, SELALU panggil tool ensure_browser terlebih dahulu.\n' +
                '2. Gunakan CDP URL yang dikembalikan ensure_browser untuk koneksi Playwright.\n' +
                '3. Gunakan discover_tasks untuk mencari microtask online yang sah.\n' +
                '4. Gunakan complete_task untuk menyelesaikan task dan mencatat penghasilan.\n' +
                '5. Ulangi sampai penghasilan mencapai $10.\n' +
                'Mulai sekarang!'
            ),
        ],
        {
            env: hermesEnv,
            cwd: path.join(__dirname, '..', 'hermes-agent'),
            stdio: 'pipe',
        }
    );

    const actionLog = fs.createWriteStream(
        path.join(logsDir, 'actions.log'),
        { flags: 'a' }
    );

    hermesProcess.stdout.on('data', data => {
        const msg = data.toString();
        process.stdout.write(`[Hermes] ${msg}`);
        actionLog.write(msg);
    });
    hermesProcess.stderr.on('data', data => {
        const msg = data.toString();
        process.stderr.write(`[Hermes ERR] ${msg}`);
        actionLog.write(msg);
    });
    hermesProcess.on('error', err => {
        console.error(`[Hermes] Gagal start: ${err.message}`);
        console.error('[Hermes] Pastikan sudah diinstall: cd hermes-agent && ./scripts/install.sh');
    });
    hermesProcess.on('exit', code => {
        console.log(`[Hermes] Proses selesai (exit code: ${code}).`);
    });

    // ── 7. Loop notifikasi Telegram setiap menit (report tiap 30 menit) ───────
    const updateInterval = setInterval(async () => {
        const total = await earningsTracker.getTotalEarnings();
        await telegramNotifier.checkPeriodicUpdate(total);
    }, 60_000);

    // ── 8. Graceful shutdown ──────────────────────────────────────────────────
    process.on('SIGINT', async () => {
        console.log('\n[Orchestrator] Menerima SIGINT — shutdown graceful...');
        clearInterval(updateInterval);
        browserWatchdog.stop();
        if (routerProcess) routerProcess.kill('SIGTERM');
        if (hermesProcess) hermesProcess.kill('SIGTERM');
        await telegramNotifier.sendAlert('🛑 HermesMoneyAgent dihentikan.');
        actionLog.close();
        process.exit(0);
    });
}

main().catch(err => {
    console.error('[Orchestrator] Fatal Error:', err);
    process.exit(1);
});
