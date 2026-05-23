/**
 * keyManager.js
 * =============
 * Mengelola rotasi Gemini API keys dan menghasilkan konfigurasi 9Router.
 *
 * Prioritas model:
 *   1. Kiro AI   → kr/claude-sonnet-4.5  (FREE, unlimited, no key)
 *   2. Gemini    → google/gemini-1.5-pro  (10 key rotasi, auto-fallback saat 429)
 *
 * 9Router menangani fallback Kiro→Gemini secara otomatis via combo strategy.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
require('dotenv').config();

class KeyManager {
    constructor() {
        this.keys = [];
        this.loadKeys();
    }

    loadKeys() {
        for (let i = 1; i <= 10; i++) {
            const key = process.env[`GEMINI_API_KEY_${i}`];
            if (key && key.trim()) {
                this.keys.push({
                    id: `gemini-key-${i}`,
                    key: key.trim(),
                    strikes: 0,
                    inCooldown: false,
                    cooldownUntil: 0,
                });
            }
        }

        if (this.keys.length === 0) {
            console.warn('[KeyManager] WARN: Tidak ada GEMINI_API_KEY di .env — menggunakan dummy keys.');
            for (let i = 1; i <= 10; i++) {
                this.keys.push({
                    id: `gemini-key-${i}`,
                    key: `dummy-key-${i}`,
                    strikes: 0,
                    inCooldown: false,
                    cooldownUntil: 0,
                });
            }
        }

        console.log(`[KeyManager] Loaded ${this.keys.length} Gemini keys (fallback pool).`);
    }

    /** Round-robin: ambil key yang tidak sedang cooldown. */
    getActiveKey() {
        const now = Date.now();
        for (const k of this.keys) {
            if (k.inCooldown && now >= k.cooldownUntil) {
                k.inCooldown = false;
                k.strikes    = 0;
            }
        }

        const available = this.keys.filter(k => !k.inCooldown);
        if (available.length === 0) {
            throw new Error('[KeyManager] Semua Gemini API key sedang cooldown — tunggu beberapa menit.');
        }

        // Round-robin: ambil pertama, pindah ke belakang
        const keyObj = available[0];
        this.keys    = this.keys.filter(k => k.id !== keyObj.id);
        this.keys.push(keyObj);

        console.log(`[KeyManager] Active key: ${keyObj.id}`);
        return keyObj.key;
    }

    /** Tandai key kena 429 — exponential backoff. */
    report429(keyString) {
        const keyObj = this.keys.find(k => k.key === keyString);
        if (!keyObj) return;

        keyObj.strikes     += 1;
        keyObj.inCooldown   = true;
        const backoffMs     = Math.pow(2, keyObj.strikes) * 60_000;
        keyObj.cooldownUntil = Date.now() + backoffMs;

        console.warn(
            `[KeyManager] ${keyObj.id} kena 429. ` +
            `Cooldown ${backoffMs / 1000}s (strike ${keyObj.strikes}).`
        );
    }

    /**
     * Generate 9Router db.json dengan:
     *   - Kiro AI sebagai provider UTAMA (priority 1, FREE)
     *   - 10 Gemini keys sebagai FALLBACK (priority 2)
     *
     * 9Router akan otomatis beralih Kiro → Gemini jika Kiro tidak tersedia.
     */
    generate9RouterConfig(dataDir) {
        const dbPath = path.join(dataDir, 'db.json');

        // Provider Kiro (FREE, no API key needed)
        const kiroConnection = {
            id: 'kiro-free',
            provider: 'kiro',
            authType: 'none',
            isActive: true,
            priority: 1,
            name: 'Kiro AI (Free Claude Sonnet 4.5)',
        };

        // 10 Gemini keys sebagai fallback
        const geminiConnections = this.keys.map((k, idx) => ({
            id: k.id,
            provider: 'google',
            authType: 'apikey',
            accessToken: k.key,
            isActive: true,
            priority: 2,
            name: `Gemini Fallback ${idx + 1}`,
        }));

        const dbConfig = {
            providerConnections: [kiroConnection, ...geminiConnections],
            settings: {
                // Fallback otomatis: coba Kiro dulu, kalau gagal → Gemini
                comboStrategy: 'fallback',
                // RTK Token Saver aktif (hemat 20-40% token)
                rtkEnabled: true,
            },
        };

        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

        fs.writeFileSync(dbPath, JSON.stringify(dbConfig, null, 2));
        console.log(
            `[KeyManager] 9Router config ditulis ke ${dbPath}\n` +
            `             Kiro (FREE) = priority 1 | Gemini x${geminiConnections.length} = priority 2 (fallback)`
        );
    }
}

module.exports = new KeyManager();
