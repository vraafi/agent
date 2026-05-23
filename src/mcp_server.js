/**
 * mcp_server.js
 * =============
 * MCP Server — jembatan antara modul Node.js dan Hermes Agent (Python).
 *
 * Tools tersedia:
 *   - discover_tasks      : Cari microtask di Toloka, Remotasks, Clickworker
 *   - complete_task       : Selesaikan task dan catat penghasilan
 *   - get_earnings        : Cek total penghasilan saat ini
 *   - send_telegram_update: Kirim pesan ke Telegram
 *   - ensure_browser      : Pastikan CloakBrowser aktif, return CDP URL
 *                           (Hermes memanggil ini sebelum setiap sesi browser)
 */

'use strict';

const { Server }                 = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport }   = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema,
}                                = require('@modelcontextprotocol/sdk/types.js');

const taskDiscovery    = require('./taskDiscovery.js');
const earningsTracker  = require('./earningsTracker.js');
const telegramNotifier = require('./telegramNotifier.js');
const browserWatchdog  = require('./browserWatchdog.js');

const server = new Server(
    { name: 'money-agent-mcp', version: '2.0.0' },
    { capabilities: { tools: {} } }
);

// ── Tool list ────────────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
        {
            name: 'discover_tasks',
            description:
                'Menemukan dan mengembalikan daftar microtask dari Toloka, Remotasks, ' +
                'dan Clickworker yang difilter berdasarkan profitabilitas.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'complete_task',
            description:
                'Menyelesaikan sebuah task dan mencatat penghasilannya. ' +
                'Panggil ini setelah memutuskan untuk mengerjakan suatu task.',
            inputSchema: {
                type: 'object',
                properties: {
                    platform: { type: 'string', description: 'Nama platform (contoh: Toloka)' },
                    taskId:   { type: 'string', description: 'ID task yang akan diselesaikan' },
                    payout:   { type: 'number', description: 'Nilai pembayaran task dalam USD' },
                },
                required: ['platform', 'taskId', 'payout'],
            },
        },
        {
            name: 'get_earnings',
            description: 'Mengembalikan total penghasilan saat ini dalam USD.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
        {
            name: 'send_telegram_update',
            description: 'Mengirim pesan notifikasi ke pengguna via Telegram.',
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
                'Memastikan CloakBrowser (Chrome stealth) sudah berjalan dan siap digunakan. ' +
                'SELALU panggil tool ini sebelum melakukan aktivitas browser apapun. ' +
                'Mengembalikan CDP URL untuk koneksi Playwright/Selenium. ' +
                'Browser akan otomatis di-restart jika tertutup.',
            inputSchema: { type: 'object', properties: {}, required: [] },
        },
    ],
}));

// ── Tool handlers ────────────────────────────────────────────────────────────
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // ── discover_tasks ───────────────────────────────────────────────────────
    if (name === 'discover_tasks') {
        const tasks = await taskDiscovery.discoverTasks();
        return {
            content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }],
        };
    }

    // ── complete_task ────────────────────────────────────────────────────────
    if (name === 'complete_task') {
        const { platform, taskId, payout } = args;
        await earningsTracker.logTask(platform, taskId, payout);
        const total = await earningsTracker.getTotalEarnings();
        return {
            content: [{
                type: 'text',
                text:
                    `Task "${taskId}" di ${platform} selesai (+$${payout}).\n` +
                    `Total penghasilan: $${total.toFixed(2)}`,
            }],
        };
    }

    // ── get_earnings ─────────────────────────────────────────────────────────
    if (name === 'get_earnings') {
        const total = await earningsTracker.getTotalEarnings();
        return {
            content: [{ type: 'text', text: `Total penghasilan saat ini: $${total.toFixed(2)}` }],
        };
    }

    // ── send_telegram_update ─────────────────────────────────────────────────
    if (name === 'send_telegram_update') {
        const { message } = args;
        await telegramNotifier.sendAlert(message);
        return {
            content: [{ type: 'text', text: `Pesan Telegram terkirim: ${message}` }],
        };
    }

    // ── ensure_browser ───────────────────────────────────────────────────────
    if (name === 'ensure_browser') {
        try {
            const { cdpUrl, port } = await browserWatchdog.ensureRunning();
            return {
                content: [{
                    type: 'text',
                    text:
                        `CloakBrowser siap digunakan.\n` +
                        `CDP URL  : ${cdpUrl}\n` +
                        `Port     : ${port}\n\n` +
                        `Cara koneksi Playwright:\n` +
                        `  browser = p.chromium.connect_over_cdp("${cdpUrl}")\n` +
                        `  page    = browser.contexts[0].pages[0]`,
                }],
            };
        } catch (err) {
            return {
                content: [{
                    type: 'text',
                    text:
                        `GAGAL memastikan CloakBrowser aktif: ${err.message}\n` +
                        `Periksa path: C:\\Users\\user\\.antigravity\\Nexus-DualBrain-AI\\bin\\cloak\\chrome.exe`,
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

// ── Start server ─────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[MCP] money-agent-mcp v2.0.0 siap.');
}

main().catch(err => {
    console.error('[MCP] Fatal:', err);
    process.exit(1);
});
