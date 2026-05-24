/**
 * mcp_server.js v5.1
 * ==================
 * MCP Server — Hermes Agent ↔ Node.js bridge.
 *
 * Tools:
 *   web_search          — Cari di DuckDuckGo (BARU)
 *   discover_tasks      — Scan platform, return peluang ranked $/jam
 *   complete_task       — Catat task selesai + cek milestone
 *   get_earnings        — Laporan sesi
 *   evaluate_strategy   — Evaluasi apakah perlu ganti platform
 *   log_strategy_switch — Catat perpindahan platform
 *   setup_platforms     — Daftar ke semua platform $0 modal
 *   check_user_signals  — Cek sinyal dari user (backup)
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
const https   = require('https');
const http    = require('http');
const path    = require('path');
const fs      = require('fs');

const taskDiscovery    = require('./taskDiscovery.js');
const earningsTracker  = require('./earningsTracker.js');
const telegramNotifier = require('./telegramNotifier.js');
const browserWatchdog  = require('./browserWatchdog.js');
const platformSetup    = require('./platformSetup.js');

const SIGNALS_DIR = path.join(__dirname, '..', '9router-data', 'signals');

const server = new Server(
    { name: 'money-agent-mcp', version: '5.1.0' },
    { capabilities: { tools: {} } }
);

// ── Web Search via DuckDuckGo ─────────────────────────────────────────────────
function duckduckgoSearch(query, maxResults = 5) {
    return new Promise((resolve) => {
        // DuckDuckGo Instant Answer API — tidak butuh API key
        const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;

        https.get(url, { headers: { 'User-Agent': 'HermesMoneyAgent/1.0' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    const results = [];

                    // AbstractText — ringkasan utama
                    if (json.AbstractText) {
                        results.push({
                            title: json.Heading || query,
                            snippet: json.AbstractText,
                            url: json.AbstractURL || '',
                            source: 'DuckDuckGo Abstract',
                        });
                    }

                    // RelatedTopics — hasil terkait
                    for (const topic of (json.RelatedTopics || [])) {
                        if (results.length >= maxResults) break;
                        if (topic.Text && topic.FirstURL) {
                            results.push({
                                title: topic.Text.split(' - ')[0] || topic.Text,
                                snippet: topic.Text,
                                url: topic.FirstURL,
                                source: 'DuckDuckGo Related',
                            });
                        }
                        // Sub-topics
                        if (topic.Topics) {
                            for (const sub of topic.Topics) {
                                if (results.length >= maxResults) break;
                                if (sub.Text && sub.FirstURL) {
                                    results.push({
                                        title: sub.Text.split(' - ')[0] || sub.Text,
                                        snippet: sub.Text,
                                        url: sub.FirstURL,
                                        source: 'DuckDuckGo Topic',
                                    });
                                }
                            }
                        }
                    }

                    // Jika tidak ada hasil, gunakan HTML search
                    if (results.length === 0) {
                        results.push({
                            title: `Cari "${query}" di DuckDuckGo`,
                            snippet: `Tidak ada hasil instant. Buka: https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                            url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                            source: 'DuckDuckGo Web',
                        });
                    }

                    resolve({ ok: true, results, query });
                } catch (e) {
                    resolve({
                        ok: false,
                        results: [{
                            title: `Cari "${query}"`,
                            snippet: `Error parsing hasil. Buka manual: https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                            url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                            source: 'Fallback',
                        }],
                        query,
                    });
                }
            });
        }).on('error', (err) => {
            resolve({
                ok: false,
                results: [{
                    title: `Cari "${query}"`,
                    snippet: `Network error: ${err.message}. URL manual: https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                    url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
                    source: 'Fallback',
                }],
                query,
            });
        });
    });
}

// ── Tool Definitions ─────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'web_search',
            description:
                'Cari informasi di internet via DuckDuckGo. GUNAKAN INI untuk:\n' +
                '- Riset platform kerja (lowongan Fastwork, Toloka, dll)\n' +
                '- Cari strategi menghasilkan uang online\n' +
                '- Cek informasi tentang suatu topik\n' +
                '- Cari tutorial atau panduan\n' +
                'Tidak butuh API key. Gratis dan bebas digunakan.',
            inputSchema: {
                type: 'object',
                properties: {
                    query: {
                        type: 'string',
                        description: 'Query pencarian. Contoh: "lowongan freelance fastwork.id penulisan artikel"',
                    },
                    max_results: {
                        type: 'number',
                        description: 'Jumlah hasil maksimal (default: 5)',
                    },
                },
                required: ['query'],
            },
        },
        {
            name: 'discover_tasks',
            description: 'Scan semua platform $0 modal. Return peluang diranking $/jam.',
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
            description: 'Laporan sesi: total earned, rate $/jam, on-track, proyeksi, rekomendasi.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'evaluate_strategy',
            description: 'Evaluasi apakah strategi saat ini cukup. Rekomendasikan platform baru jika tidak on-track.',
            inputSchema: {
                type: 'object',
                properties: { current_platform: { type: 'string' } },
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
            description: 'Daftar otomatis ke semua platform $0 modal via CloakBrowser.',
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
            description: 'Cek sinyal/perintah dari user yang belum diproses (backup file-based).',
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
            description: 'Pastikan CloakBrowser (stealth, anti-bot) berjalan. Return CDP URL.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
    ],
}));

// ── Tool Handlers ────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── web_search ────────────────────────────────────────────────────────────
    if (name === 'web_search') {
        const { query, max_results = 5 } = args;
        console.error(`[MCP] web_search: "${query}"`);
        const { ok, results } = await duckduckgoSearch(query, max_results);

        const rows = results.map((r, i) =>
            `${i + 1}. ${r.title}\n   ${r.snippet}\n   🔗 ${r.url}`
        ).join('\n\n');

        return {
            content: [{
                type: 'text',
                text:
                    `=== HASIL PENCARIAN: "${query}" ===\n\n${rows}\n\n` +
                    `🔍 Cari lebih lanjut: https://duckduckgo.com/?q=${encodeURIComponent(query)}\n` +
                    `Status: ${ok ? '✅ OK' : '⚠ Partial'} | ${results.length} hasil`,
            }],
        };
    }

    // ── discover_tasks ────────────────────────────────────────────────────────
    if (name === 'discover_tasks') {
        const opps = await taskDiscovery.discoverTasks();
        const top  = opps.slice(0, 8);
        const rows = top.map((t, i) =>
            `${i + 1}. [${t.platform}] — $${t.estimatedPayPerHour}/jam\n` +
            `   URL: ${t.url}\n   Biaya join: $${t.costToJoin}\n` +
            `   Cara mulai: ${t.howToStart || '-'}`
        ).join('\n\n');

        return {
            content: [{
                type: 'text',
                text:
                    `=== PLATFORM $0 MODAL ===\n\n${rows}\n\n` +
                    `🥇 PRIORITAS UTAMA: Fastwork.id (fastwork.id) — freelance Indonesia\n\n` +
                    `JSON:\n${JSON.stringify(opps, null, 2)}`,
            }],
        };
    }

    // ── complete_task ─────────────────────────────────────────────────────────
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
                    `⚡ Rate: ${report.currentRatePerHour}/jam\n` +
                    `💡 ${report.recommendation}`,
            }],
        };
    }

    // ── get_earnings ──────────────────────────────────────────────────────────
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
                    `\nPer Platform:\n${byPlatform}\n\n💡 ${report.recommendation}`,
            }],
        };
    }

    // ── evaluate_strategy ─────────────────────────────────────────────────────
    if (name === 'evaluate_strategy') {
        const { current_platform } = args;
        const report = await earningsTracker.getSessionReport();
        let advice = '';
        if (report.needStrategySwitch) {
            advice =
                `❌ GANTI PLATFORM!\n${current_platform} terlalu lambat.\n\n` +
                `PINDAH KE: Fastwork.id atau DataAnnotation.tech\n` +
                `Gunakan web_search("lowongan fastwork.id") untuk riset.`;
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
                    `=== EVALUASI STRATEGI ===\nPlatform: ${current_platform}\n` +
                    `Earned: ${report.sessionEarned} | Rate: ${report.currentRatePerHour}/jam\n\n` + advice,
            }],
        };
    }

    // ── log_strategy_switch ───────────────────────────────────────────────────
    if (name === 'log_strategy_switch') {
        await earningsTracker.logStrategySwitch(args.from_platform, args.to_platform, args.reason);
        return {
            content: [{
                type: 'text',
                text: `✅ Dicatat: ${args.from_platform} → ${args.to_platform}\nAlasan: ${args.reason}`,
            }],
        };
    }

    // ── setup_platforms ───────────────────────────────────────────────────────
    if (name === 'setup_platforms') {
        const { email, password } = args;
        if (!email || !password)
            return { content: [{ type: 'text', text: '❌ Email dan password wajib.' }], isError: true };
        const results = await platformSetup.runSetup(email, password);
        const summary = Object.entries(results).map(([k, v]) => `${k}: ${v.status}`).join('\n');
        return { content: [{ type: 'text', text: `=== HASIL SETUP ===\n${summary}` }] };
    }

    // ── check_user_signals ────────────────────────────────────────────────────
    if (name === 'check_user_signals') {
        const signals = [];
        const stateFile = path.join(__dirname, '..', '9router-data', 'platform_accounts.json');
        if (fs.existsSync(stateFile)) {
            const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
            for (const [platform, info] of Object.entries(state.registered || {})) {
                if (info.confirmedByUser && info.status === 'active') {
                    const ageMinutes = (Date.now() - new Date(info.confirmedAt || 0).getTime()) / 60_000;
                    if (ageMinutes < 60) {
                        signals.push({ type: 'platform_ready', platform, message: `${platform} dikonfirmasi user!` });
                    }
                }
            }
        }
        if (fs.existsSync(SIGNALS_DIR)) {
            const files = fs.readdirSync(SIGNALS_DIR).filter(f => f.endsWith('.json'));
            for (const file of files) {
                try {
                    const filePath = path.join(SIGNALS_DIR, file);
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const ageMinutes = (Date.now() - new Date(data.at || 0).getTime()) / 60_000;
                    if (ageMinutes < 120) {
                        signals.push({ type: data.type || 'signal', ...data, file });
                        fs.unlinkSync(filePath);
                    }
                } catch (_) {}
            }
        }
        if (signals.length === 0) {
            return { content: [{ type: 'text', text: 'Tidak ada sinyal baru dari user.\nDalam Gateway Mode, user berbicara langsung via Telegram.' }] };
        }
        const summary = signals.map(s => `[${s.type}] ${s.platform || ''} — ${s.message || JSON.stringify(s)}`).join('\n');
        return { content: [{ type: 'text', text: `=== SINYAL (${signals.length} baru) ===\n\n${summary}` }] };
    }

    // ── send_telegram_update ──────────────────────────────────────────────────
    if (name === 'send_telegram_update') {
        await telegramNotifier.sendAlert(args.message);
        return { content: [{ type: 'text', text: '✅ Pesan Telegram terkirim.' }] };
    }

    // ── ensure_browser ────────────────────────────────────────────────────────
    if (name === 'ensure_browser') {
        try {
            const { cdpUrl } = await browserWatchdog.ensureRunning();
            return {
                content: [{
                    type: 'text',
                    text:
                        `✅ Browser siap.\nCDP URL: ${cdpUrl}\n` +
                        `Koneksi: chromium.connect_over_cdp("${cdpUrl}")`,
                }],
            };
        } catch (err) {
            return { content: [{ type: 'text', text: `❌ Browser error: ${err.message}` }], isError: true };
        }
    }

    return { content: [{ type: 'text', text: `Tool tidak dikenal: ${name}` }], isError: true };
});

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] money-agent-mcp v5.1.0 siap. Tool: web_search (DuckDuckGo) aktif.');
}

main().catch(err => { console.error('[MCP] Fatal:', err); process.exit(1); });
