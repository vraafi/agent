/**
 * mcp_server.js v5.0
 * ==================
 * MCP Server — Hermes Agent ↔ Node.js bridge.
 *
 * Tools:
 *   discover_tasks      — Scan platform, return peluang ranked $/jam
 *   complete_task       — Catat task selesai + cek milestone
 *   get_earnings        — Laporan sesi: rate, on-track, rekomendasi
 *   evaluate_strategy   — Evaluasi apakah perlu ganti platform
 *   log_strategy_switch — Catat perpindahan platform
 *   setup_platforms     — Daftar ke semua platform $0 modal
 *   check_user_signals  — Cek sinyal/perintah dari user (backup bridge)
 *   send_telegram_update— Kirim notif ke Telegram
 *   ensure_browser      — Pastikan CloakBrowser aktif
 *
 * CATATAN: Hermes v7+ berjalan dalam GATEWAY MODE.
 * Pesan Telegram user diterima langsung oleh Hermes (busy_input_mode: steer).
 * Tool check_user_signals ini sebagai BACKUP untuk membaca sinyal file-based
 * jika gateway belum dikonfigurasi.
 */

'use strict';

const { Server }               = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
}                              = require('@modelcontextprotocol/sdk/types.js');
const path = require('path');
const fs   = require('fs');

const taskDiscovery    = require('./taskDiscovery.js');
const earningsTracker  = require('./earningsTracker.js');
const telegramNotifier = require('./telegramNotifier.js');
const browserWatchdog  = require('./browserWatchdog.js');
const platformSetup    = require('./platformSetup.js');

const SIGNALS_DIR = path.join(__dirname, '..', '9router-data', 'signals');

const server = new Server(
    { name: 'money-agent-mcp', version: '5.0.0' },
    { capabilities: { tools: {} } }
);

// ── Tool Definitions ─────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'discover_tasks',
            description:
                'Scan semua platform $0 modal yang bisa dikerjakan AI otonom (tanpa telepon/VC). ' +
                'Return peluang diranking $/jam. Panggil di awal sesi dan setiap ganti strategi.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'complete_task',
            description: 'Catat task selesai dan payout-nya. Wajib dipanggil setiap task selesai.',
            inputSchema: {
                type: 'object',
                properties: {
                    platform: { type: 'string' },
                    taskId:   { type: 'string' },
                    payout:   { type: 'number', description: 'Payout dalam USD' },
                    taskType: { type: 'string' },
                },
                required: ['platform', 'taskId', 'payout'],
            },
        },
        {
            name: 'get_earnings',
            description: 'Laporan sesi: total earned, rate $/jam, on-track, proyeksi, rekomendasi. Panggil setiap 30 menit.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'evaluate_strategy',
            description:
                'Evaluasi apakah strategi saat ini cukup untuk $10/8jam. ' +
                'Jika tidak on-track setelah 30 menit, rekomendasikan platform baru yang lebih bayar.',
            inputSchema: {
                type: 'object',
                properties: {
                    current_platform: { type: 'string' },
                },
                required: ['current_platform'],
            },
        },
        {
            name: 'log_strategy_switch',
            description: 'Catat perpindahan platform beserta alasannya.',
            inputSchema: {
                type: 'object',
                properties: {
                    from_platform: { type: 'string' },
                    to_platform:   { type: 'string' },
                    reason:        { type: 'string' },
                },
                required: ['from_platform', 'to_platform', 'reason'],
            },
        },
        {
            name: 'setup_platforms',
            description:
                'Daftar otomatis ke semua platform $0 modal via CloakBrowser. ' +
                'Panggil SEKALI di awal jika akun belum ada.',
            inputSchema: {
                type: 'object',
                properties: {
                    email:    { type: 'string' },
                    password: { type: 'string' },
                },
                required: ['email', 'password'],
            },
        },
        {
            name: 'check_user_signals',
            description:
                'Cek apakah ada sinyal/perintah baru dari user yang belum diproses.\n' +
                'CATATAN: Dalam Gateway Mode, perintah user datang langsung via Telegram.\n' +
                'Tool ini membaca FILE SINYAL sebagai backup jika ada perintah yang terlewat.\n' +
                'Return: daftar sinyal pending (platform_ready, pause, switch, dll).\n' +
                'Panggil ini jika kamu belum menerima update dari user dalam 15 menit.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'send_telegram_update',
            description: 'Kirim notifikasi atau laporan ke user via Telegram.',
            inputSchema: {
                type: 'object',
                properties: { message: { type: 'string' } },
                required: ['message'],
            },
        },
        {
            name: 'ensure_browser',
            description:
                'WAJIB sebelum membuka website apapun. ' +
                'Pastikan CloakBrowser (stealth, anti-bot) berjalan. ' +
                'Return CDP URL untuk koneksi Playwright.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
    ],
}));

// ── Tool Handlers ────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── discover_tasks ───────────────────────────────────────────────────────
    if (name === 'discover_tasks') {
        const opps = await taskDiscovery.discoverTasks();
        const top  = opps.slice(0, 8);
        const rows = top.map((t, i) =>
            `${i + 1}. [${t.platform}] — $${t.estimatedPayPerHour}/jam\n` +
            `   URL: ${t.url}\n` +
            `   Biaya join: $${t.costToJoin} (GRATIS)\n` +
            `   Withdrawal: ${t.withdrawal || '-'}\n` +
            `   Cara mulai: ${t.howToStart || '-'}`
        ).join('\n\n');

        return {
            content: [{
                type: 'text',
                text:
                    `=== PLATFORM $0 MODAL — RANKED $/JAM ===\n\n${rows}\n\n` +
                    `SEMUA platform GRATIS untuk bergabung.\n` +
                    `REKOMENDASI: DataAnnotation.tech ($15/jam) atau Outlier AI ($20/jam).\n\n` +
                    `JSON lengkap:\n${JSON.stringify(opps, null, 2)}`,
            }],
        };
    }

    // ── complete_task ────────────────────────────────────────────────────────
    if (name === 'complete_task') {
        const { platform, taskId, payout, taskType = 'unknown' } = args;
        await earningsTracker.logTask(platform, taskId, payout, taskType);
        const report = await earningsTracker.getSessionReport();
        return {
            content: [{
                type: 'text',
                text:
                    `✅ Task selesai: +$${payout} dari ${platform}\n` +
                    `📊 Sesi: ${report.sessionEarned} / ${report.sessionTarget}\n` +
                    `⚡ Rate: ${report.currentRatePerHour}/jam (target: ${report.targetRatePerHour})\n` +
                    `${report.statusIcon} ${report.onTrack ? 'ON TRACK ✅' : 'PERLU PERCEPATAN ⚠'}\n` +
                    `💡 ${report.recommendation}`,
            }],
        };
    }

    // ── get_earnings ─────────────────────────────────────────────────────────
    if (name === 'get_earnings') {
        const report = await earningsTracker.getSessionReport();
        const byPlatform = report.earningsByPlatform
            .map(r => `  ${r.platform}: $${r.total_payout?.toFixed(2)} (${r.task_count} task)`)
            .join('\n') || '  (belum ada data)';
        return {
            content: [{
                type: 'text',
                text:
                    `=== LAPORAN SESI ===\n` +
                    `💰 Earned: ${report.sessionEarned} / ${report.sessionTarget}\n` +
                    `⏱  Berjalan: ${report.elapsedHours} jam | Sisa: ${report.remainingHours} jam\n` +
                    `⚡ Rate: ${report.currentRatePerHour}/jam | Target: ${report.targetRatePerHour}\n` +
                    `📈 Proyeksi 8 jam: ${report.projectedTotal}\n` +
                    `${report.statusIcon} ${report.onTrack ? 'ON TRACK ✅' : 'KURANG DARI TARGET ⚠'}\n` +
                    `\nPer Platform:\n${byPlatform}\n` +
                    `\n💡 ${report.recommendation}`,
            }],
        };
    }

    // ── evaluate_strategy ────────────────────────────────────────────────────
    if (name === 'evaluate_strategy') {
        const { current_platform } = args;
        const report = await earningsTracker.getSessionReport();
        let advice = '';

        if (report.needStrategySwitch) {
            const alts = [
                { name: 'DataAnnotation.tech', url: 'https://www.dataannotation.tech', pay: 15 },
                { name: 'Outlier AI',          url: 'https://outlier.ai',              pay: 20 },
                { name: 'Textbroker',          url: 'https://www.textbroker.com',      pay: 4  },
                { name: 'Scale AI',            url: 'https://scale.com/ai-tasker',     pay: 2.5 },
            ].filter(a => a.name !== current_platform);

            advice =
                `❌ GANTI PLATFORM!\n${current_platform} terlalu lambat.\n\n` +
                `PINDAH KE: ${alts[0].name} — $${alts[0].pay}/jam\n` +
                `URL: ${alts[0].url}\n\n` +
                `Alternatif:\n` +
                alts.slice(1, 3).map(a => `  • ${a.name} ($${a.pay}/jam)`).join('\n');
        } else {
            advice =
                `✅ ${current_platform} cukup baik.\n` +
                `Rate: ${report.currentRatePerHour}/jam | Proyeksi: ${report.projectedTotal}\n` +
                `Lanjutkan — evaluasi lagi dalam 30 menit.`;
        }

        return {
            content: [{
                type: 'text',
                text: `=== EVALUASI STRATEGI ===\nPlatform: ${current_platform}\n` +
                      `Earned: ${report.sessionEarned} | Rate: ${report.currentRatePerHour}/jam\n\n` + advice,
            }],
        };
    }

    // ── log_strategy_switch ──────────────────────────────────────────────────
    if (name === 'log_strategy_switch') {
        await earningsTracker.logStrategySwitch(args.from_platform, args.to_platform, args.reason);
        return {
            content: [{
                type: 'text',
                text: `✅ Dicatat: ${args.from_platform} → ${args.to_platform}\nAlasan: ${args.reason}`,
            }],
        };
    }

    // ── setup_platforms ──────────────────────────────────────────────────────
    if (name === 'setup_platforms') {
        const { email, password } = args;
        if (!email || !password) {
            return { content: [{ type: 'text', text: '❌ Email dan password wajib.' }], isError: true };
        }
        const results = await platformSetup.runSetup(email, password);
        const summary = Object.entries(results).map(([k, v]) => `${k}: ${v.status}`).join('\n');
        return { content: [{ type: 'text', text: `=== HASIL SETUP ===\n${summary}` }] };
    }

    // ── check_user_signals ───────────────────────────────────────────────────
    if (name === 'check_user_signals') {
        const signals = [];

        // Baca platform_accounts.json untuk platform yang baru dikonfirmasi
        const stateFile = path.join(__dirname, '..', '9router-data', 'platform_accounts.json');
        if (fs.existsSync(stateFile)) {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            for (const [platform, info] of Object.entries(state.registered || {})) {
                if (info.confirmedByUser && info.status === 'active') {
                    const confirmedAt = new Date(info.confirmedAt || 0);
                    const ageMinutes  = (Date.now() - confirmedAt.getTime()) / 60_000;
                    if (ageMinutes < 60) { // Hanya 60 menit terakhir
                        signals.push({
                            type: 'platform_ready',
                            platform,
                            message: `${platform} dikonfirmasi user — mulai kerja di sana!`,
                            confirmedAt: info.confirmedAt,
                        });
                    }
                }
            }
        }

        // Baca file sinyal dari direktori signals/
        if (fs.existsSync(SIGNALS_DIR)) {
            const files = fs.readdirSync(SIGNALS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const filePath = path.join(SIGNALS_DIR, file);
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const ageMinutes = (Date.now() - new Date(data.at || 0).getTime()) / 60_000;
                    if (ageMinutes < 120) {
                        signals.push({ type: data.type || 'signal', ...data, file });
                        // Hapus setelah dibaca
                        fs.unlinkSync(filePath);
                    }
                } catch (_) {}
            }
        }

        if (signals.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `=== SINYAL USER ===\n` +
                        `Tidak ada sinyal baru dari user.\n\n` +
                        `CATATAN: Dalam Gateway Mode, user berbicara langsung dengan kamu via Telegram.\n` +
                        `Pesan masuk saat kamu bekerja akan di-inject setelah tool call berikutnya (steer mode).\n` +
                        `Tool ini hanya untuk membaca sinyal file-based yang mungkin terlewat.`,
                }],
            };
        }

        const summary = signals.map(s =>
            `[${s.type}] ${s.platform || ''} — ${s.message || JSON.stringify(s)}`
        ).join('\n');

        return {
            content: [{
                type: 'text',
                text:
                    `=== SINYAL DARI USER (${signals.length} baru) ===\n\n${summary}\n\n` +
                    `AKSI YANG DIREKOMENDASIKAN:\n` +
                    signals.filter(s => s.type === 'platform_ready').map(s =>
                        `→ ${s.platform} siap! Buka ${s.platform} dan mulai kerja di sana.`
                    ).join('\n'),
            }],
        };
    }

    // ── send_telegram_update ─────────────────────────────────────────────────
    if (name === 'send_telegram_update') {
        await telegramNotifier.sendAlert(args.message);
        return { content: [{ type: 'text', text: '✅ Pesan Telegram terkirim.' }] };
    }

    // ── ensure_browser ───────────────────────────────────────────────────────
    if (name === 'ensure_browser') {
        try {
            const { cdpUrl } = await browserWatchdog.ensureRunning();
            return {
                content: [{
                    type: 'text',
                    text:
                        `✅ CloakBrowser siap (stealth mode).\n` +
                        `CDP URL: ${cdpUrl}\n` +
                        `Koneksi Playwright: chromium.connect_over_cdp("${cdpUrl}")`,
                }],
            };
        } catch (err) {
            return {
                content: [{ type: 'text', text: `❌ CloakBrowser error: ${err.message}` }],
                isError: true,
            };
        }
    }

    return { content: [{ type: 'text', text: `Tool tidak dikenal: ${name}` }], isError: true };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] money-agent-mcp v5.0.0 siap.');
}

main().catch(err => { console.error('[MCP] Fatal:', err); process.exit(1); });
