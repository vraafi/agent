const fs = require('fs');
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
            if (key && key.trim() !== '') {
                this.keys.push({
                    id: `gemini-key-${i}`,
                    key: key.trim(),
                    strikes: 0,
                    inCooldown: false,
                    cooldownUntil: 0
                });
            }
        }

        // Provide dummy keys if none in env for testing without failing immediately
        if (this.keys.length === 0) {
            console.log("WARN: No GEMINI_API_KEYs found in .env, using dummies for configuration generation.");
            for (let i = 1; i <= 10; i++) {
                 this.keys.push({
                    id: `gemini-key-${i}`,
                    key: `dummy-key-${i}`,
                    strikes: 0,
                    inCooldown: false,
                    cooldownUntil: 0
                });
            }
        }
    }

    // Logic for internal round-robin / 429 rotation tracking
    // 9router natively handles rotation if we generate the db.json,
    // but the prompt explicitly asked for KeyManager to have:
    // "Round-robin rotation", "Auto-switch on HTTP 429 with exponential backoff", "Log which key is active"

    getActiveKey() {
        const now = Date.now();
        for (const k of this.keys) {
            if (k.inCooldown && now >= k.cooldownUntil) {
                k.inCooldown = false;
                k.strikes = 0;
            }
        }

        const availableKeys = this.keys.filter(k => !k.inCooldown);
        if (availableKeys.length === 0) {
            throw new Error("All API keys are exhausted or in cooldown.");
        }

        // Simple round-robin: take the first available and move it to the back
        const keyObj = availableKeys[0];
        this.keys = this.keys.filter(k => k.id !== keyObj.id);
        this.keys.push(keyObj);

        console.log(`[KeyManager] Active Key: ${keyObj.id}`);
        return keyObj.key;
    }

    report429(keyString) {
        const keyObj = this.keys.find(k => k.key === keyString);
        if (keyObj) {
            keyObj.strikes += 1;
            keyObj.inCooldown = true;
            // Exponential backoff: 2^strikes * 1 minute
            const backoffMs = Math.pow(2, keyObj.strikes) * 60000;
            keyObj.cooldownUntil = Date.now() + backoffMs;
            console.log(`[KeyManager] Key ${keyObj.id} hit 429. Cooldown for ${backoffMs/1000}s. Strikes: ${keyObj.strikes}`);
        }
    }

    /**
     * Generates the 9router db.json configuration so 9Router
     * itself natively knows about the 10 keys and maps them to "google"
     * as instructed.
     */
    generate9RouterConfig(dataDir) {
        const dbPath = path.join(dataDir, 'db.json');

        const providerConnections = this.keys.map(k => ({
            id: k.id,
            provider: "google",
            authType: "apikey",
            accessToken: k.key,
            isActive: true,
            priority: 1,
            name: `Gemini Key ${k.id.split('-').pop()}`
        }));

        const dbConfig = {
            providerConnections: providerConnections,
            settings: {
                comboStrategy: "fallback"
            }
        };

        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        fs.writeFileSync(dbPath, JSON.stringify(dbConfig, null, 2));
        console.log(`[KeyManager] Generated 9router db.json at ${dbPath} with ${providerConnections.length} keys.`);
    }
}

module.exports = new KeyManager();
