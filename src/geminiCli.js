/**
 * geminiCli.js
 * ============
 * Ultra-lightweight rotating proxy for Google AI Studio (Gemini/Gemma).
 * - Rotates 10 API keys automatically via KeyManager.
 * - Handles 429 rate limits by rotating to the next key.
 * - Automatically falls back from Model A (gemma-4-31b-it) to Model B (gemma-4-26b-a4b-it)
 *   if all keys are rate-limited on Model A.
 * - Supports streaming (SSE) and non-streaming requests.
 * - Extremely memory efficient (< 15MB RAM).
 */

'use strict';

const http = require('http');
const https = require('https');
const keyManager = require('./keyManager');

const PORT = Number(process.env.GEMINI_CLI_PORT || process.env.NINEROUTER_PORT || 8080);
const MODEL_A = 'gemma-4-31b-it';
const MODEL_B = 'gemma-4-26b-a4b-it';

const server = http.createServer((req, res) => {
    // Health check
    if (req.url === '/api/health' || req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', provider: 'gemini-cli' }));
        return;
    }

    if (req.method === 'POST' && (req.url === '/v1/chat/completions' || req.url === '/chat/completions')) {
        let bodyChunks = [];
        req.on('data', chunk => bodyChunks.push(chunk));
        req.on('end', () => {
            const bodyStr = Buffer.concat(bodyChunks).toString();
            let payload;
            try {
                payload = JSON.parse(bodyStr);
            } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
                return;
            }

            handleChatCompletion(payload, req, res);
        });
        return;
    }

    // Pass through any other routes
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
});

async function handleChatCompletion(payload, req, res) {
    let attempt = 0;
    const maxAttempts = keyManager.keys.length * 2; // Try keys twice
    let requestedModel = payload.model || 'gemma-4-31b-it';
    let currentModel = requestedModel;

    // Map custom/alias model names to real Google AI Studio model names
    const getGoogleModel = (modelName) => {
        if (modelName === 'gemma-4-31b-it') {
            return 'gemma-4-31b-it'; // Model A (Gemma 4 31B)
        }
        if (modelName === 'gemma-4-26b-a4b-it') {
            return 'gemma-4-26b-a4b-it'; // Model B (Gemma 4 26B)
        }
        return modelName;
    };

    const makeRequest = () => {
        if (attempt >= maxAttempts) {
            // Switch model as last resort
            if (requestedModel === 'gemma-4-31b-it') {
                console.log(`[GeminiCli] ⚠️ All keys rate-limited for ${requestedModel}. Falling back to MODEL_B...`);
                requestedModel = 'gemma-4-26b-a4b-it';
                currentModel = requestedModel;
                attempt = 0; // Reset attempts for model B
            } else {
                res.writeHead(429, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'All API keys exhausted and rate-limited.' }));
                return;
            }
        }

        let activeKey;
        try {
            activeKey = keyManager.getActiveKey();
        } catch (err) {
            console.warn(`[GeminiCli] ⚠️ ${err.message}. Forcing round-robin fallback.`);
            const fallbackKeyObj = keyManager.keys[attempt % keyManager.keys.length];
            activeKey = fallbackKeyObj.key;
        }

        // Prepare request body with the mapped google model name
        const apiModelName = getGoogleModel(currentModel);
        const modifiedPayload = { ...payload, model: apiModelName };
        const requestData = JSON.stringify(modifiedPayload);

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            port: 443,
            path: `/v1beta/openai/chat/completions`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${activeKey}`,
            }
        };

        console.log(`[GeminiCli] Forwarding request (Model: ${currentModel}, Attempt: ${attempt + 1}/${maxAttempts})`);

        const gReq = https.request(options, (gRes) => {
            // If Rate Limited (429), Denied (403), Unauthorized (401), or Server Error (500)
            if (gRes.statusCode === 429 || gRes.statusCode === 403 || gRes.statusCode === 401 || gRes.statusCode === 500) {
                console.warn(`[GeminiCli] Error ${gRes.statusCode} received from active key. Rotating...`);
                if (gRes.statusCode === 429) {
                    keyManager.report429(activeKey);
                } else {
                    // Put bad/restricted key in long cooldown (1 hour)
                    const keyObj = keyManager.keys.find(k => k.key === activeKey);
                    if (keyObj) {
                        keyObj.inCooldown = true;
                        keyObj.cooldownUntil = Date.now() + 3600_000;
                    }
                }
                attempt++;
                makeRequest();
                return;
            }

            // Copy status code and headers
            res.writeHead(gRes.statusCode, gRes.headers);

            // Pipe response back to client (supports SSE streaming natively)
            gRes.pipe(res);
        });

        gReq.on('error', (err) => {
            console.error(`[GeminiCli] Connection error: ${err.message}`);
            attempt++;
            makeRequest();
        });

        gReq.write(requestData);
        gReq.end();
    };

    makeRequest();
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`[GeminiCli] Rotating Proxy active on http://127.0.0.1:${PORT}`);
    console.log(`[GeminiCli] Model A: ${MODEL_A} | Model B: ${MODEL_B}`);
});
