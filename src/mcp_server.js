/**
 * mcp_server.js v3.0
 * ==================
 * MCP Server — jembatan Node.js ↔ Hermes Agent (Python).
 *
 * Tools:
 *   discover_tasks      — Scan semua platform, return peluang diranking $/jam
 *   complete_task       — Catat task selesai + cek milestone
 *   get_earnings        — Laporan lengkap sesi: rate, on-track, rekomendasi
 *   evaluate_strategy   — Evaluasi apakah perlu ganti platform/strategi
 *   log_strategy_switch — Catat perpindahan platform
 *   send_telegram_update— Kirim notif ke Telegram
 *   ensure_browser      — Pastikan CloakBrowser aktif, return CDP URL
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

const server = new Server(
    { name: 'money-agent-mcp', version: '3.0.0' },
    { capabilities: { tools: {} } }
);

// ── Tool Definitions ─────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'discover_tasks',
            description:
                'Scan semua platform freelance dan microtask yang 100% bisa dikerjakan AI secara otonom ' +
                '(tanpa telepon, tanpa video call). ' +
                'Return daftar peluang diurutkan dari $/jam tertinggi. ' +
                'Panggil ini di awal sesi dan setiap kali perlu ganti strategi.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'complete_task',
            description:
                'Catat satu task yang sudah diselesaikan dan payout-nya. ' +
                'Wajib dipanggil setiap kali berhasil menyelesaikan pekerjaan apapun.',
            inputSchema: {
                type: 'object',
                properties: {
                    platform: { type: 'string', description: 'Nama platform (contoh: Toloka, DataAnnotation.tech, Fastwork.id)' },
                    taskId:   { type: 'string', description: 'ID atau deskripsi singkat task yang diselesaikan' },
                    payout:   { type: 'number', description: 'Nilai payout dalam USD' },
                    taskType: { type: 'string', description: 'Tipe task (contoh: image_classification, article_writing, rlhf_rating)' },
                },
                required: ['platform', 'taskId', 'payout'],
            },
        },
        {
            name: 'get_earnings',
            description:
                'Laporan lengkap sesi: total earned, earning rate ($/jam), ' +
                'apakah on-track menuju $10, proyeksi total, dan rekomendasi strategi. ' +
                'Panggil ini setiap 30 menit untuk evaluasi progress.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'evaluate_strategy',
            description:
                'Evaluasi apakah strategi saat ini cukup untuk mencapai target $10/8jam. ' +
                'Jika tidak on-track setelah 30 menit, tool ini akan merekomendasikan platform baru ' +
                'yang bayarnya lebih tinggi (DataAnnotation.tech $15/jam, Outlier AI $20/jam). ' +
                'Return: apakah perlu ganti strategi + platform yang disarankan.',
            inputSchema: {
                type: 'object',
                properties: {
                    current_platform: { type: 'string', description: 'Platform yang sedang digunakan saat ini' },
                },
                required: ['current_platform'],
            },
        },
        {
            name: 'log_strategy_switch',
            description: 'Catat pergantian platform/strategi beserta alasannya untuk tracking.',
            inputSchema: {
                type: 'object',
                properties: {
                    from_platform: { type: 'string' },
                    to_platform:   { type: 'string' },
                    reason:        { type: 'string', description: 'Alasan ganti platform (contoh: rate terlalu rendah, task habis)' },
                },
                required: ['from_platform', 'to_platform', 'reason'],
            },
        },
        {
            name: 'send_telegram_update',
            description: 'Kirim notifikasi progress ke pengguna via Telegram.',
            inputSchema: {
                type: 'object',
                properties: {
                    message: { type: 'string', description: 'Pesan yang akan dikirim' },
                },
                required: ['message'],
            },
        },
        {
            name: 'ensure_browser',
            description:
                'WAJIB dipanggil sebelum membuka website atau menggunakan browser. ' +
                'Memastikan CloakBrowser (Chrome stealth, anti-bot-detection) sudah berjalan. ' +
                'CloakBrowser akan otomatis restart jika tertutup — tidak akan pernah mati permanen. ' +
                'Return: CDP URL untuk koneksi Playwright ke browser.',
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
        const top5 = opportunities.slice(0, 5);
        const summary = top5.map((t, i) =>
            `${i + 1}. [${t.platform}] ${t.title}\n` +
            `   $/jam: ~$${t.estimatedPayPerHour} | Tier: ${t.tier} | Login: ${t.loginRequired ? 'Ya (user bantu)' : 'Tidak'}\n` +
            `   URL: ${t.url}\n` +
            `   Catatan: ${t.notes}`
        ).join('\n\n');

        return {
            content: [{
                type: 'text',
                text:
                    `=== PELUANG PENGHASILAN OTONOM (Top ${top5.length}) ===\n\n` +
                    summary +
                    `\n\n--- Total ${opportunities.length} platform tersedia ---\n` +
                    `REKOMENDASI UTAMA: Mulai dari DataAnnotation.tech ($15/jam) atau ` +
                    `Outlier AI ($20/jam) untuk mencapai target $10/8jam paling cepat.\n` +
                    `Data JSON lengkap:\n${JSON.stringify(opportunities, null, 2)}`,
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
                    `${report.statusIcon} ${report.onTrack ? 'ON TRACK' : 'PERLU PERCEPATAN'}\n` +
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
        let switchRecommendation = null;

        if (report.needStrategySwitch) {
            const alternatives = [
                { name: 'DataAnnotation.tech', url: 'https://www.dataannotation.tech', payPerHour: 15, reason: 'RLHF rating, code review — AI sangat cocok' },
                { name: 'Outlier AI',          url: 'https://outlier.ai',              payPerHour: 20, reason: 'AI trainer tasks — bayar tertinggi' },
                { name: 'Textbroker',           url: 'https://www.textbroker.com',       payPerHour: 4,  reason: 'Artikel OpenOrder — langsung kerjakan tanpa apply' },
                { name: 'Scale AI',             url: 'https://scale.com/ai-tasker',      payPerHour: 2.5, reason: 'RLHF tasks — volume besar' },
                { name: 'Remotasks',            url: 'https://www.remotasks.com',         payPerHour: 2,  reason: 'Annotation task — stabil' },
            ].filter(a => a.name !== current_platform);

            switchRecommendation = alternatives[0];
            advice =
                `❌ GANTI STRATEGI DIPERLUKAN!\n` +
                `Platform saat ini (${current_platform}) terlalu lambat.\n\n` +
                `REKOMENDASI PINDAH KE: ${switchRecommendation.name}\n` +
                `URL: ${switchRecommendation.url}\n` +
                `Potensi: $${switchRecommendation.payPerHour}/jam\n` +
                `Kenapa: ${switchRecommendation.reason}\n\n` +
                `Alternatif lain:\n` +
                alternatives.slice(1).map(a =>
                    `  • ${a.name} ($${a.payPerHour}/jam) — ${a.reason}`
                ).join('\n');
        } else {
            advice =
                `✅ Strategi saat ini (${current_platform}) cukup baik.\n` +
                `Rate: ${report.currentRatePerHour}/jam\n` +
                `Proyeksi: ${report.projectedTotal} dalam 8 jam.\n` +
                `Tetap lanjutkan — evaluasi lagi dalam 30 menit.`;
        }

        return {
            content: [{
                type: 'text',
                text:
                    `=== EVALUASI STRATEGI ===\n` +
                    `Platform aktif: ${current_platform}\n` +
                    `Earned: ${report.sessionEarned} | Rate: ${report.currentRatePerHour}/jam\n\n` +
                    advice,
            }],
        };
    }

    // ── log_strategy_switch ──────────────────────────────────────────────────
    if (name === 'log_strategy_switch') {
        const { from_platform, to_platform, reason } = args;
        await earningsTracker.logStrategySwitch(from_platform, to_platform, reason);
        return {
            content: [{
                type: 'text',
                text: `✅ Perpindahan dicatat: ${from_platform} → ${to_platform}\nAlasan: ${reason}`,
            }],
        };
    }

    // ── send_telegram_update ─────────────────────────────────────────────────
    if (name === 'send_telegram_update') {
        await telegramNotifier.sendAlert(args.message);
        return { content: [{ type: 'text', text: `Telegram terkirim: ${args.message}` }] };
    }

    // ── ensure_browser ───────────────────────────────────────────────────────
    if (name === 'ensure_browser') {
        try {
            const { cdpUrl, port } = await browserWatchdog.ensureRunning();
            return {
                content: [{
                    type: 'text',
                    text:
                        `✅ CloakBrowser siap (stealth mode, anti-bot-detection aktif).\n` +
                        `CDP URL: ${cdpUrl}\n` +
                        `Port   : ${port}\n\n` +
                        `Koneksi Playwright:\n` +
                        `  browser = p.chromium.connect_over_cdp("${cdpUrl}")\n` +
                        `  page    = browser.contexts[0].pages[0]\n\n` +
                        `CATATAN: CloakBrowser menggunakan teknik stealth sehingga tidak terdeteksi\n` +
                        `sebagai bot oleh Toloka, Remotasks, Fastwork, Fiverr, dll.`,
                }],
            };
        } catch (err) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `❌ CloakBrowser gagal start: ${err.message}\n` +
                        `Path: C:\\Users\\user\\.antigravity\\Nexus-DualBrain-AI\\bin\\cloak\\chrome.exe\n` +
                        `Watchdog akan terus mencoba restart otomatis setiap 5 detik.`,
                }],
                isError: true,
            };
        }
    }

    return {
        content: [{ type: 'text', text: `Tool tidak dikenal: ${name}` }],
        isError: true,
    };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] money-agent-mcp v3.0.0 — siap melayani Hermes Agent.');
}

main().catch(err => { console.error('[MCP] Fatal:', err); process.exit(1); });
