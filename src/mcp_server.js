/**
 * mcp_server.js v4.0
 * ==================
 * MCP Server — Hermes Agent ↔ Node.js bridge.
 *
 * Tools:
 *   discover_tasks      — Scan platform, return peluang ranked $/jam
 *   complete_task       — Catat task selesai + cek milestone
 *   get_earnings        — Laporan sesi: rate, on-track, rekomendasi
 *   evaluate_strategy   — Evaluasi apakah perlu ganti platform
 *   log_strategy_switch — Catat perpindahan platform
 *   setup_platforms     — Daftar ke semua platform $0 modal via CloakBrowser
 *   send_telegram_update— Kirim notif ke Telegram
 *   ensure_browser      — Pastikan CloakBrowser aktif
 */

'use strict';

const { Server }               = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
}                              = require('@modelcontextprotocol/sdk/types.js');

const taskDiscovery    = require('./taskDiscovery.js');
const earningsTracker  = require('./earningsTracker.js');
const telegramNotifier = require('./telegramNotifier.js');
const browserWatchdog  = require('./browserWatchdog.js');
const platformSetup    = require('./platformSetup.js');

const server = new Server(
    { name: 'money-agent-mcp', version: '4.0.0' },
    { capabilities: { tools: {} } }
);

// ── Tool Definitions ─────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'discover_tasks',
            description:
                'Scan semua platform freelance dan microtask yang bisa dikerjakan AI secara otonom ' +
                '(tanpa telepon, tanpa VC, $0 modal). ' +
                'Return daftar peluang diurutkan $/jam tertinggi. ' +
                'Panggil ini di awal sesi dan setiap ganti strategi.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'complete_task',
            description: 'Catat task yang selesai dan payout-nya. Wajib dipanggil setiap task selesai.',
            inputSchema: {
                type: 'object',
                properties: {
                    platform: { type: 'string', description: 'Nama platform' },
                    taskId:   { type: 'string', description: 'ID atau deskripsi singkat task' },
                    payout:   { type: 'number', description: 'Nilai payout dalam USD' },
                    taskType: { type: 'string', description: 'Tipe task (misal: rlhf_rating, article_writing)' },
                },
                required: ['platform', 'taskId', 'payout'],
            },
        },
        {
            name: 'get_earnings',
            description:
                'Laporan sesi: total earned, rate $/jam, on-track menuju $10, proyeksi, rekomendasi. ' +
                'Panggil setiap 30 menit.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'evaluate_strategy',
            description:
                'Evaluasi apakah strategi saat ini cukup untuk $10/8jam. ' +
                'Jika tidak on-track setelah 30 menit, rekomendasikan platform yang lebih bayar. ' +
                'Return: perlu ganti atau tidak + platform alternatif.',
            inputSchema: {
                type: 'object',
                properties: {
                    current_platform: { type: 'string', description: 'Platform yang sedang digunakan' },
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
                'Urutan: DataAnnotation.tech → Outlier AI → Toloka → Remotasks → Textbroker. ' +
                'Panggil ini SEKALI di awal jika akun belum ada. ' +
                'Untuk Toloka (butuh Google login), notifikasi dikirim ke user via Telegram.',
            inputSchema: {
                type: 'object',
                properties: {
                    email:    { type: 'string', description: 'Email untuk registrasi semua platform' },
                    password: { type: 'string', description: 'Password yang akan digunakan' },
                },
                required: ['email', 'password'],
            },
        },
        {
            name: 'send_telegram_update',
            description: 'Kirim notifikasi progress atau permintaan bantuan ke user via Telegram.',
            inputSchema: {
                type: 'object',
                properties: {
                    message: { type: 'string' },
                },
                required: ['message'],
            },
        },
        {
            name: 'ensure_browser',
            description:
                'WAJIB dipanggil sebelum membuka website apapun. ' +
                'Memastikan CloakBrowser (stealth, anti-bot) berjalan dan siap. ' +
                'Return: CDP URL untuk koneksi Playwright.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
    ],
}));

// ── Tool Handlers ────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── discover_tasks ───────────────────────────────────────────────────────
    if (name === 'discover_tasks') {
        const opportunities = await taskDiscovery.discoverTasks();
        const top = opportunities.slice(0, 8);
        const rows = top.map((t, i) =>
            `${i + 1}. [${t.platform}] ${t.title}\n` +
            `   $/jam: ~$${t.estimatedPayPerHour} | Tier: ${t.tier} | Biaya join: $${t.costToJoin}\n` +
            `   URL: ${t.url}\n` +
            `   Cara mulai: ${t.howToStart || '-'}\n` +
            `   Withdrawal: ${t.withdrawal || '-'}`
        ).join('\n\n');

        return {
            content: [{
                type: 'text',
                text:
                    `=== PLATFORM $0 MODAL — DIRANKING $/JAM ===\n\n${rows}\n\n` +
                    `SEMUA platform di atas GRATIS untuk bergabung.\n` +
                    `REKOMENDASI: Mulai DataAnnotation.tech ($15/jam) atau Outlier AI ($20/jam).\n` +
                    `JSON lengkap:\n${JSON.stringify(opportunities, null, 2)}`,
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
            .map(r => `  ${r.platform}: $${r.total_payout?.toFixed(2)} (${r.task_count} tasks)`)
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
                { name: 'DataAnnotation.tech', url: 'https://www.dataannotation.tech', pay: 15, why: 'RLHF rating, review kode AI — cocok sempurna' },
                { name: 'Outlier AI',          url: 'https://outlier.ai',              pay: 20, why: 'AI trainer — bayar tertinggi' },
                { name: 'Textbroker',          url: 'https://www.textbroker.com',      pay: 4,  why: 'OpenOrder artikel — langsung bisa ambil' },
                { name: 'Scale AI',            url: 'https://scale.com/ai-tasker',     pay: 2.5, why: 'RLHF tasks — volume besar' },
            ].filter(a => a.name !== current_platform);

            const top = alts[0];
            advice =
                `❌ GANTI STRATEGI!\n` +
                `${current_platform} terlalu lambat untuk target $10.\n\n` +
                `PINDAH KE: ${top.name}\n` +
                `URL: ${top.url}\n` +
                `Potensi: $${top.pay}/jam\n` +
                `Kenapa: ${top.why}\n\n` +
                `Alternatif lain:\n` +
                alts.slice(1, 3).map(a => `  • ${a.name} ($${a.pay}/jam) — ${a.why}`).join('\n');
        } else {
            advice =
                `✅ ${current_platform} cukup baik.\n` +
                `Rate: ${report.currentRatePerHour}/jam | Proyeksi: ${report.projectedTotal}\n` +
                `Lanjutkan — evaluasi lagi dalam 30 menit.`;
        }

        return {
            content: [{
                type: 'text',
                text:
                    `=== EVALUASI STRATEGI ===\n` +
                    `Platform: ${current_platform}\n` +
                    `Earned: ${report.sessionEarned} | Rate: ${report.currentRatePerHour}/jam\n\n` +
                    advice,
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
            return {
                content: [{ type: 'text', text: '❌ Email dan password wajib diisi untuk setup platform.' }],
                isError: true,
            };
        }

        // Cek apakah semua sudah terdaftar
        const allReady = ['DataAnnotation.tech', 'Outlier AI', 'Remotasks', 'Textbroker']
            .every(p => platformSetup.isRegistered(p));

        if (allReady) {
            return {
                content: [{ type: 'text', text: '✅ Semua platform utama sudah terdaftar. Siap kerja!' }],
            };
        }

        const results = await platformSetup.runSetup(email, password);
        const summary = Object.entries(results)
            .map(([k, v]) => `${k}: ${v.status}`)
            .join('\n');

        return {
            content: [{
                type: 'text',
                text:
                    `=== HASIL SETUP PLATFORM ===\n${summary}\n\n` +
                    `Platform yang perlu verifikasi email: cek inbox ${email}.\n` +
                    `Platform yang perlu login Google (Toloka): notifikasi sudah dikirim ke Telegram user.`,
            }],
        };
    }

    // ── send_telegram_update ─────────────────────────────────────────────────
    if (name === 'send_telegram_update') {
        await telegramNotifier.sendAlert(args.message);
        return { content: [{ type: 'text', text: `✅ Telegram terkirim.` }] };
    }

    // ── ensure_browser ───────────────────────────────────────────────────────
    if (name === 'ensure_browser') {
        try {
            const { cdpUrl, port } = await browserWatchdog.ensureRunning();
            return {
                content: [{
                    type: 'text',
                    text:
                        `✅ CloakBrowser siap (stealth mode aktif).\n` +
                        `CDP URL: ${cdpUrl}\n` +
                        `Koneksi Playwright:\n` +
                        `  browser = chromium.connect_over_cdp("${cdpUrl}")\n` +
                        `  page    = browser.contexts()[0].pages()[0]`,
                }],
            };
        } catch (err) {
            return {
                content: [{
                    type: 'text',
                    text: `❌ CloakBrowser error: ${err.message}\nWatchdog akan retry otomatis.`,
                }],
                isError: true,
            };
        }
    }

    return { content: [{ type: 'text', text: `Tool tidak dikenal: ${name}` }], isError: true };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] money-agent-mcp v4.0.0 siap.');
}

main().catch(err => { console.error('[MCP] Fatal:', err); process.exit(1); });
