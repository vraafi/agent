/**
 * telegramListener.js
 * ===================
 * Mendengarkan pesan masuk dari user via Telegram Bot API (long-polling).
 * Memproses perintah teks untuk mengontrol agent secara real-time.
 *
 * PERINTAH YANG DIDUKUNG:
 *   "toloka ok"       — Tandai Toloka sudah login, agent mulai kerja di Toloka
 *   "da ok"           — DataAnnotation.tech sudah siap (email diverifikasi)
 *   "outlier ok"      — Outlier AI sudah siap (email diverifikasi)
 *   "remotasks ok"    — Remotasks sudah siap
 *   "textbroker ok"   — Textbroker sudah siap
 *   "status"          — Laporan earnings sesi saat ini
 *   "stop"            — Hentikan agent dengan aman (SIGINT)
 *   "pause"           — Pause sementara (Hermes berhenti ambil task baru)
 *   "resume"          — Lanjut setelah pause
 *   "switch [nama]"   — Paksa ganti platform (contoh: "switch Textbroker")
 *   "help"            — Tampilkan semua perintah
 *
 * CARA KERJA:
 *   Menggunakan long-polling (getUpdates) — tidak butuh webhook/server publik.
 *   Hanya menerima pesan dari chat_id yang sesuai TELEGRAM_CHAT_ID.
 */

'use strict';

const https = require('https');
const EventEmitter = require('events');
const path  = require('path');
const fs    = require('fs');

class TelegramListener extends EventEmitter {
    constructor() {
        super();
        this.token     = process.env.TELEGRAM_BOT_TOKEN || '';
        this.chatId    = process.env.TELEGRAM_CHAT_ID   || '';
        this.offset    = 0;
        this.polling   = false;
        this.paused    = false;
        this._interval = null;

        // State file untuk sinkronisasi dengan platformSetup
        this.stateFile = path.join(__dirname, '..', '9router-data', 'platform_accounts.json');

        if (!this.token || !this.chatId) {
            console.warn('[TelegramListener] ⚠ TELEGRAM_BOT_TOKEN atau TELEGRAM_CHAT_ID tidak diset.');
            console.warn('[TelegramListener] Listener tidak akan berjalan. Set env vars lalu restart.');
        }
    }

    /**
     * Mulai polling Telegram setiap 3 detik.
     */
    start() {
        if (!this.token || !this.chatId) return;
        if (this.polling) return;

        this.polling = true;
        console.log('[TelegramListener] ✅ Mulai polling Telegram...');
        this._poll();
    }

    stop() {
        this.polling = false;
        if (this._interval) clearTimeout(this._interval);
        console.log('[TelegramListener] Berhenti polling.');
    }

    async _poll() {
        if (!this.polling) return;

        try {
            const updates = await this._getUpdates();
            for (const update of updates) {
                this.offset = update.update_id + 1;
                await this._handleUpdate(update);
            }
        } catch (err) {
            console.error('[TelegramListener] Poll error:', err.message);
        }

        this._interval = setTimeout(() => this._poll(), 3000);
    }

    async _handleUpdate(update) {
        const msg = update.message || update.edited_message;
        if (!msg || !msg.text) return;

        // KEAMANAN: Hanya terima pesan dari chat_id yang benar
        if (String(msg.chat.id) !== String(this.chatId)) {
            console.warn(`[TelegramListener] Pesan dari chat_id tidak dikenal: ${msg.chat.id}`);
            return;
        }

        const text = msg.text.trim().toLowerCase();
        console.log(`[TelegramListener] Perintah diterima: "${text}"`);

        await this._processCommand(text, msg.text.trim());
    }

    async _processCommand(textLower, textOriginal) {
        // ── Platform OK ──────────────────────────────────────────────────────
        const platformOkMap = {
            'toloka ok':     'Toloka',
            'da ok':         'DataAnnotation.tech',
            'dataannotation ok': 'DataAnnotation.tech',
            'outlier ok':    'Outlier AI',
            'remotasks ok':  'Remotasks',
            'textbroker ok': 'Textbroker',
            'iwriter ok':    'iWriter',
            'scale ok':      'Scale AI',
            'fastwork ok':   'Fastwork.id',
        };

        for (const [cmd, platform] of Object.entries(platformOkMap)) {
            if (textLower.startsWith(cmd)) {
                await this._markPlatformReady(platform);
                return;
            }
        }

        // ── Status ───────────────────────────────────────────────────────────
        if (textLower === 'status' || textLower === 'laporan') {
            this.emit('command:status');
            return;
        }

        // ── Stop ─────────────────────────────────────────────────────────────
        if (textLower === 'stop' || textLower === 'berhenti') {
            await this._send(
                '🛑 *Agent akan dihentikan...*\nMenyelesaikan task saat ini, lalu berhenti.'
            );
            this.emit('command:stop');
            return;
        }

        // ── Pause ────────────────────────────────────────────────────────────
        if (textLower === 'pause' || textLower === 'jeda') {
            this.paused = true;
            await this._send('⏸ *Agent di-pause.*\nKirim "resume" untuk melanjutkan.');
            this.emit('command:pause');
            return;
        }

        // ── Resume ───────────────────────────────────────────────────────────
        if (textLower === 'resume' || textLower === 'lanjut') {
            this.paused = false;
            await this._send('▶ *Agent dilanjutkan.*');
            this.emit('command:resume');
            return;
        }

        // ── Switch Platform ──────────────────────────────────────────────────
        if (textLower.startsWith('switch ') || textLower.startsWith('ganti ')) {
            const parts  = textOriginal.split(' ');
            const target = parts.slice(1).join(' ');
            if (target) {
                await this._send(`🔄 Memindahkan agent ke: *${target}*...`);
                this.emit('command:switch', target);
            }
            return;
        }

        // ── Help ─────────────────────────────────────────────────────────────
        if (textLower === 'help' || textLower === 'bantuan' || textLower === '/help') {
            await this._sendHelp();
            return;
        }

        // ── Perintah tidak dikenal ───────────────────────────────────────────
        await this._send(
            `❓ Perintah tidak dikenal: "${textOriginal}"\n\nKirim "help" untuk melihat semua perintah.`
        );
    }

    /**
     * Tandai platform sebagai siap dan emit event agar agent mulai kerja di sana.
     */
    async _markPlatformReady(platform) {
        try {
            // Update state file platformSetup
            let state = { registered: {} };
            if (fs.existsSync(this.stateFile)) {
                state = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
            }

            const prev = state.registered[platform]?.status || 'unknown';
            state.registered[platform] = {
                ...state.registered[platform],
                status: 'active',
                confirmedByUser: true,
                confirmedAt: new Date().toISOString(),
            };

            const dir = path.dirname(this.stateFile);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));

            console.log(`[TelegramListener] ✅ ${platform} dikonfirmasi user. Status: ${prev} → active`);

            await this._send(
                `✅ *${platform} siap!*\n` +
                `Agent akan mulai mengerjakan task di ${platform} sekarang.\n\n` +
                `Kirim "status" untuk melihat progress earning.`
            );

            // Emit event agar start.js / platformSetup bisa bereaksi
            this.emit('platform:ready', platform);

        } catch (err) {
            console.error(`[TelegramListener] Error marking ${platform} ready:`, err.message);
            await this._send(`❌ Gagal update status ${platform}: ${err.message}`);
        }
    }

    async _sendHelp() {
        const help =
            `🤖 *HermesMoneyAgent — Perintah Telegram*\n\n` +
            `*Konfirmasi Platform (setelah login/verifikasi):*\n` +
            `• \`toloka ok\` — Toloka sudah login Google\n` +
            `• \`da ok\` — DataAnnotation.tech sudah verifikasi email\n` +
            `• \`outlier ok\` — Outlier AI sudah verifikasi email\n` +
            `• \`remotasks ok\` — Remotasks sudah siap\n` +
            `• \`textbroker ok\` — Textbroker sudah siap\n\n` +
            `*Kontrol Agent:*\n` +
            `• \`status\` — Lihat laporan earning sesi ini\n` +
            `• \`pause\` — Hentikan sementara (tidak ambil task baru)\n` +
            `• \`resume\` — Lanjutkan setelah pause\n` +
            `• \`switch Textbroker\` — Paksa pindah ke platform tertentu\n` +
            `• \`stop\` — Hentikan agent dengan aman\n\n` +
            `Target sesi: *$10 dalam 8 jam* ($1.25/jam)\n` +
            `Semua platform: *$0 modal*, gratis bergabung.`;

        await this._send(help);
    }

    /**
     * Kirim pesan ke user via Telegram Bot API.
     */
    _send(text) {
        return new Promise((resolve) => {
            if (!this.token || !this.chatId) { resolve(); return; }

            const body = JSON.stringify({
                chat_id:    this.chatId,
                text:       text,
                parse_mode: 'Markdown',
            });

            const req = https.request({
                hostname: 'api.telegram.org',
                path:     `/bot${this.token}/sendMessage`,
                method:   'POST',
                headers:  {
                    'Content-Type':   'application/json',
                    'Content-Length': Buffer.byteLength(body),
                },
            }, res => {
                res.on('data', () => {});
                res.on('end', () => resolve());
            });

            req.on('error', err => {
                console.error('[TelegramListener] Send error:', err.message);
                resolve();
            });

            req.write(body);
            req.end();
        });
    }

    /**
     * Ambil update terbaru dari Telegram.
     */
    _getUpdates() {
        return new Promise((resolve, reject) => {
            const params = new URLSearchParams({
                offset:  String(this.offset),
                timeout: '10',
                allowed_updates: '["message","edited_message"]',
            });

            const req = https.request({
                hostname: 'api.telegram.org',
                path:     `/bot${this.token}/getUpdates?${params}`,
                method:   'GET',
            }, res => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.ok) resolve(parsed.result || []);
                        else reject(new Error(`Telegram API: ${parsed.description}`));
                    } catch (e) {
                        reject(e);
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(15_000, () => { req.destroy(); resolve([]); });
            req.end();
        });
    }

    /**
     * Kirim pesan status ke user (dipanggil dari luar saat ada update penting).
     */
    async sendStatus(report) {
        const byPlatform = (report.earningsByPlatform || [])
            .map(r => `  • ${r.platform}: $${r.total_payout?.toFixed(2)} (${r.task_count} task)`)
            .join('\n') || '  (belum ada data)';

        await this._send(
            `📊 *Status Sesi*\n\n` +
            `💰 Earned: ${report.sessionEarned} / ${report.sessionTarget}\n` +
            `⏱ Berjalan: ${report.elapsedHours} jam\n` +
            `⚡ Rate: ${report.currentRatePerHour}/jam\n` +
            `📈 Proyeksi: ${report.projectedTotal}\n` +
            `${report.statusIcon} ${report.onTrack ? 'ON TRACK ✅' : 'PERLU PERCEPATAN ⚠'}\n\n` +
            `*Per Platform:*\n${byPlatform}\n\n` +
            `💡 ${report.recommendation}`
        );
    }

    isPaused() { return this.paused; }
}

module.exports = new TelegramListener();
