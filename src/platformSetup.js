/**
 * platformSetup.js
 * ================
 * Mendaftarkan Hermes secara otonom ke platform penghasilan terbaik.
 * Berjalan satu kali di awal sesi (atau ketika akun belum ada).
 *
 * Urutan registrasi (dari yang paling menguntungkan):
 *   1. DataAnnotation.tech  — $15/jam
 *   2. Outlier AI           — $20/jam
 *   3. Toloka               — $1.5/jam (login Google, paling mudah)
 *   4. Remotasks            — $2/jam
 *   5. Textbroker           — $3/jam
 *
 * Setiap platform memiliki langkah-langkah spesifik.
 * Hermes memanggil onboardingRunner.js untuk otomasi browser.
 */

'use strict';

const path           = require('path');
const fs             = require('fs');
const onboarding     = require('./onboardingRunner');
const telegramNotifier = require('./telegramNotifier');

// File state — simpan platform mana yang sudah terdaftar
const STATE_FILE = path.join(__dirname, '..', '9router-data', 'platform_accounts.json');

class PlatformSetup {
    constructor() {
        this.state = this._loadState();
    }

    _loadState() {
        try {
            if (fs.existsSync(STATE_FILE)) {
                return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
            }
        } catch (_) {}
        return { registered: {}, lastChecked: null };
    }

    _saveState() {
        const dir = path.dirname(STATE_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2));
    }

    isRegistered(platform) {
        return this.state.registered[platform]?.status === 'active';
    }

    markRegistered(platform, email, notes = '') {
        this.state.registered[platform] = {
            status: 'active',
            email,
            notes,
            registeredAt: new Date().toISOString(),
        };
        this._saveState();
    }

    markPending(platform, email, notes = '') {
        this.state.registered[platform] = {
            status: 'pending_approval',
            email,
            notes,
            registeredAt: new Date().toISOString(),
        };
        this._saveState();
    }

    /**
     * Jalankan setup untuk semua platform yang belum terdaftar.
     * Dipanggil di awal sesi oleh start.js.
     */
    async runSetup(userEmail, userPassword) {
        // Lewati semua otomasi browser jika SKIP_BROWSER=true atau CloakBrowser tidak tersedia
        if (process.env.SKIP_BROWSER === 'true') {
            console.log('[PlatformSetup] ⚠ SKIP_BROWSER=true — otomasi browser dilewati.');
            console.log('[PlatformSetup] Tip: Login manual ke platform, lalu kirim konfirmasi via Telegram.');
            return { skipped: true, reason: 'SKIP_BROWSER=true' };
        }

        // Cek apakah CloakBrowser CDP port aktif sebelum mencoba koneksi
        const net     = require('net');
        const cdpPort = Number(process.env.CLOAK_DEBUG_PORT || 9223);
        const cdpAlive = await new Promise(resolve => {
            const sock = new net.Socket();
            sock.setTimeout(1500);
            sock.once('connect', () => { sock.destroy(); resolve(true); });
            sock.once('timeout',  () => { sock.destroy(); resolve(false); });
            sock.once('error',    () => { sock.destroy(); resolve(false); });
            sock.connect(cdpPort, '127.0.0.1');
        });

        if (!cdpAlive) {
            console.warn(`[PlatformSetup] ⚠ CloakBrowser tidak aktif di port ${cdpPort} — otomasi browser dilewati.`);
            console.warn(`[PlatformSetup] Tip: Jalankan CloakBrowser dulu, atau set SKIP_BROWSER=true di .env`);
            return { skipped: true, reason: `CDP port ${cdpPort} tidak aktif` };
        }

        console.log('\n[PlatformSetup] ═══ SETUP PLATFORM ═══');
        console.log(`[PlatformSetup] Email: ${userEmail}`);

        const results = {};

        // 1. DataAnnotation.tech — PRIORITAS UTAMA
        if (!this.isRegistered('DataAnnotation.tech')) {
            console.log('\n[PlatformSetup] [1/5] DataAnnotation.tech...');
            results.dataannotation = await this._setupDataAnnotation(userEmail, userPassword);
        } else {
            console.log('[PlatformSetup] ✅ DataAnnotation.tech sudah terdaftar');
            results.dataannotation = { status: 'already_registered' };
        }

        // 2. Outlier AI
        if (!this.isRegistered('Outlier AI')) {
            console.log('\n[PlatformSetup] [2/5] Outlier AI...');
            results.outlier = await this._setupOutlierAI(userEmail, userPassword);
        } else {
            console.log('[PlatformSetup] ✅ Outlier AI sudah terdaftar');
            results.outlier = { status: 'already_registered' };
        }

        // 3. Toloka (login Google — perlu user)
        if (!this.isRegistered('Toloka')) {
            console.log('\n[PlatformSetup] [3/5] Toloka (butuh login Google dari user)...');
            results.toloka = await this._setupToloka(userEmail);
        } else {
            console.log('[PlatformSetup] ✅ Toloka sudah terdaftar');
            results.toloka = { status: 'already_registered' };
        }

        // 4. Remotasks
        if (!this.isRegistered('Remotasks')) {
            console.log('\n[PlatformSetup] [4/5] Remotasks...');
            results.remotasks = await this._setupRemotasks(userEmail, userPassword);
        } else {
            console.log('[PlatformSetup] ✅ Remotasks sudah terdaftar');
            results.remotasks = { status: 'already_registered' };
        }

        // 5. Textbroker
        if (!this.isRegistered('Textbroker')) {
            console.log('\n[PlatformSetup] [5/5] Textbroker...');
            results.textbroker = await this._setupTextbroker(userEmail, userPassword);
        } else {
            console.log('[PlatformSetup] ✅ Textbroker sudah terdaftar');
            results.textbroker = { status: 'already_registered' };
        }

        // Ringkasan
        const summary = this._buildSummary(results);
        console.log('\n[PlatformSetup] ═══ SELESAI ═══');
        console.log(summary);
        await telegramNotifier.sendAlert(`📋 *Setup Platform Selesai*\n\n${summary}`);

        return results;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP INDIVIDUAL — DataAnnotation.tech
    // ─────────────────────────────────────────────────────────────────────────
    async _setupDataAnnotation(email, password) {
        try {
            console.log('[DataAnnotation] Membuka browser...');
            const page = await onboarding.getPage();

            // Langkah 1: Navigasi ke halaman daftar
            await page.goto('https://www.dataannotation.tech/login', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            // Langkah 2: Cek apakah sudah login atau perlu daftar baru
            const currentUrl = page.url();
            if (currentUrl.includes('dashboard') || currentUrl.includes('tasks')) {
                console.log('[DataAnnotation] ✅ Sudah login sebelumnya!');
                this.markRegistered('DataAnnotation.tech', email, 'Login otomatis berhasil');
                return { status: 'already_logged_in' };
            }

            // Langkah 3: Coba login dulu (mungkin sudah punya akun)
            const loginResult = await onboarding.tryLogin(page, {
                emailSelector:    'input[type="email"], input[name="email"]',
                passwordSelector: 'input[type="password"], input[name="password"]',
                submitSelector:   'button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")',
                successUrl:       ['dashboard', 'tasks', 'home'],
                email,
                password,
            });

            if (loginResult.success) {
                console.log('[DataAnnotation] ✅ Login berhasil!');
                this.markRegistered('DataAnnotation.tech', email, 'Login berhasil');
                return { status: 'logged_in' };
            }

            // Langkah 4: Login gagal — coba daftar baru
            console.log('[DataAnnotation] Login gagal. Mencoba daftar baru...');
            await page.goto('https://www.dataannotation.tech/signup', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            const registerResult = await onboarding.fillRegistrationForm(page, {
                fields: {
                    'input[name="first_name"], input[placeholder*="first"]': 'Hermes',
                    'input[name="last_name"], input[placeholder*="last"]':  'Agent',
                    'input[type="email"], input[name="email"]':             email,
                    'input[type="password"], input[name="password"]':       password,
                    'input[name="password_confirmation"], input[placeholder*="confirm"]': password,
                },
                submitSelector: 'button[type="submit"]',
                successUrl: ['dashboard', 'onboarding', 'welcome'],
            });

            if (registerResult.success) {
                console.log('[DataAnnotation] ✅ Registrasi berhasil! Mungkin ada tes onboarding...');

                // Langkah 5: Selesaikan tes onboarding jika ada
                const testResult = await onboarding.completeOnboardingTest(page, {
                    platform: 'DataAnnotation.tech',
                    testTypes: ['multiple_choice', 'rating_task', 'comparison'],
                    strategy: 'careful',  // AI menjawab dengan teliti
                });

                this.markRegistered('DataAnnotation.tech', email,
                    `Terdaftar. Test: ${testResult.passed ? 'LULUS' : 'perlu review'}`);

                return { status: 'registered', testPassed: testResult.passed };
            }

            // Mungkin perlu verifikasi email
            console.log('[DataAnnotation] Mungkin perlu verifikasi email. Kirim notif ke user.');
            await telegramNotifier.sendAlert(
                `📧 *DataAnnotation.tech*\n` +
                `Registrasi terkirim ke ${email}.\n` +
                `Silakan cek email dan klik link verifikasi, lalu balas pesan ini.`
            );
            this.markPending('DataAnnotation.tech', email, 'Menunggu verifikasi email');
            return { status: 'pending_email_verification' };

        } catch (err) {
            console.error(`[DataAnnotation] Error: ${err.message}`);
            return { status: 'error', message: err.message };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP INDIVIDUAL — Outlier AI
    // ─────────────────────────────────────────────────────────────────────────
    async _setupOutlierAI(email, password) {
        try {
            console.log('[OutlierAI] Membuka browser...');
            const page = await onboarding.getPage();

            await page.goto('https://app.outlier.ai/en/experts/login', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            // Cek sudah login
            if (page.url().includes('dashboard') || page.url().includes('tasks')) {
                this.markRegistered('Outlier AI', email, 'Sudah login');
                return { status: 'already_logged_in' };
            }

            // Coba login
            const loginResult = await onboarding.tryLogin(page, {
                emailSelector:    'input[type="email"]',
                passwordSelector: 'input[type="password"]',
                submitSelector:   'button[type="submit"]',
                successUrl:       ['dashboard', 'experts', 'tasks', 'home'],
                email,
                password,
            });

            if (loginResult.success) {
                this.markRegistered('Outlier AI', email, 'Login berhasil');
                return { status: 'logged_in' };
            }

            // Daftar baru
            console.log('[OutlierAI] Mencoba daftar baru...');
            await page.goto('https://app.outlier.ai/en/experts/signup', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            // Outlier AI mungkin pakai Google/email magic link
            // Coba isi form dulu
            const hasEmailForm = await page.$('input[type="email"]');
            if (hasEmailForm) {
                await page.fill('input[type="email"]', email);

                // Cek apakah ada field password atau magic link
                const hasPassword = await page.$('input[type="password"]');
                if (hasPassword) {
                    await page.fill('input[type="password"]', password);
                }

                await page.click('button[type="submit"]');
                await page.waitForTimeout(3000);
            }

            // Outlier AI sering kirim magic link ke email
            await telegramNotifier.sendAlert(
                `📧 *Outlier AI*\n` +
                `Link magic/verifikasi dikirim ke ${email}.\n` +
                `Silakan klik link di email, lalu Hermes akan melanjutkan tes onboarding.`
            );
            this.markPending('Outlier AI', email, 'Menunggu verifikasi email / magic link');
            return { status: 'pending_email_verification' };

        } catch (err) {
            console.error(`[OutlierAI] Error: ${err.message}`);
            return { status: 'error', message: err.message };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP INDIVIDUAL — Toloka (butuh login Google dari user)
    // ─────────────────────────────────────────────────────────────────────────
    async _setupToloka(email) {
        try {
            const page = await onboarding.getPage();
            await page.goto('https://toloka.ai/tolokers/', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            // Cek apakah sudah login
            const isLoggedIn = await page.$('[data-testid="user-menu"], .user-avatar, a[href*="logout"]');
            if (isLoggedIn) {
                console.log('[Toloka] ✅ Sudah login!');
                this.markRegistered('Toloka', email, 'Sudah login Google');
                return { status: 'already_logged_in' };
            }

            // Toloka butuh Google login — minta user
            await telegramNotifier.sendAlert(
                `🔐 *Toloka — Login Diperlukan*\n` +
                `Toloka menggunakan Google Sign In.\n\n` +
                `Silakan login manual:\n` +
                `1. Buka browser yang sedang berjalan\n` +
                `2. Pergi ke: https://toloka.ai/tolokers/\n` +
                `3. Klik "Sign in with Google"\n` +
                `4. Login dengan akun Google kamu\n\n` +
                `Setelah login, balas pesan ini dengan "toloka ok" agar Hermes lanjut bekerja.`
            );

            this.markPending('Toloka', email, 'Menunggu login Google dari user');
            return { status: 'waiting_user_login', message: 'Notifikasi sudah dikirim ke user via Telegram' };

        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP INDIVIDUAL — Remotasks
    // ─────────────────────────────────────────────────────────────────────────
    async _setupRemotasks(email, password) {
        try {
            const page = await onboarding.getPage();
            await page.goto('https://www.remotasks.com/en/login', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            const loginResult = await onboarding.tryLogin(page, {
                emailSelector:    'input[type="email"], input[name="email"]',
                passwordSelector: 'input[type="password"]',
                submitSelector:   'button[type="submit"]',
                successUrl:       ['dashboard', 'tasks', 'home'],
                email,
                password,
            });

            if (loginResult.success) {
                this.markRegistered('Remotasks', email, 'Login berhasil');
                return { status: 'logged_in' };
            }

            // Daftar baru
            await page.goto('https://www.remotasks.com/en/signup', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            const registerResult = await onboarding.fillRegistrationForm(page, {
                fields: {
                    'input[name="first_name"]':  'Hermes',
                    'input[name="last_name"]':   'Agent',
                    'input[type="email"]':       email,
                    'input[type="password"]':    password,
                },
                submitSelector: 'button[type="submit"]',
                successUrl: ['dashboard', 'onboarding', 'tasks'],
            });

            if (registerResult.success) {
                // Remotasks punya onboarding quiz
                console.log('[Remotasks] Daftar berhasil. Mencoba quiz onboarding...');
                const testResult = await onboarding.completeOnboardingTest(page, {
                    platform: 'Remotasks',
                    testTypes: ['multiple_choice', 'categorization'],
                    strategy: 'careful',
                });
                this.markRegistered('Remotasks', email,
                    `Quiz: ${testResult.passed ? 'LULUS' : 'perlu coba lagi'}`);
                return { status: 'registered', testPassed: testResult.passed };
            }

            this.markPending('Remotasks', email, 'Menunggu verifikasi email');
            return { status: 'pending_email_verification' };

        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SETUP INDIVIDUAL — Textbroker
    // ─────────────────────────────────────────────────────────────────────────
    async _setupTextbroker(email, password) {
        try {
            const page = await onboarding.getPage();
            await page.goto('https://www.textbroker.com/authors/login', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            const loginResult = await onboarding.tryLogin(page, {
                emailSelector:    'input[type="email"], input[name="email"], input[name="login"]',
                passwordSelector: 'input[type="password"], input[name="password"]',
                submitSelector:   'button[type="submit"], input[type="submit"]',
                successUrl:       ['dashboard', 'authorarea', 'orders'],
                email,
                password,
            });

            if (loginResult.success) {
                this.markRegistered('Textbroker', email, 'Login berhasil');
                return { status: 'logged_in' };
            }

            // Daftar baru
            await page.goto('https://www.textbroker.com/authors/registration', {
                waitUntil: 'domcontentloaded', timeout: 30_000,
            });

            const registerResult = await onboarding.fillRegistrationForm(page, {
                fields: {
                    'input[name="firstname"], input[id*="first"]': 'Hermes',
                    'input[name="lastname"], input[id*="last"]':   'Agent',
                    'input[type="email"]':                         email,
                    'input[type="password"]':                      password,
                    'input[name="password2"]':                     password,
                },
                checkboxes: [
                    'input[type="checkbox"][name*="terms"]',
                    'input[type="checkbox"][name*="privacy"]',
                ],
                submitSelector: 'button[type="submit"], input[type="submit"]',
                successUrl: ['authorarea', 'dashboard', 'welcome'],
            });

            if (registerResult.success) {
                // Textbroker butuh contoh artikel untuk dinilai
                console.log('[Textbroker] Daftar berhasil. Menulis artikel contoh...');
                const sampleResult = await onboarding.writeTextbrokerSample(page);

                this.markRegistered('Textbroker', email,
                    `Artikel contoh: ${sampleResult.submitted ? 'terkirim' : 'perlu submit manual'}`);
                return { status: 'registered', sampleSubmitted: sampleResult.submitted };
            }

            this.markPending('Textbroker', email, 'Menunggu verifikasi email');
            return { status: 'pending_email_verification' };

        } catch (err) {
            return { status: 'error', message: err.message };
        }
    }

    _buildSummary(results) {
        const lines = [];
        const map = {
            dataannotation: 'DataAnnotation.tech',
            outlier:        'Outlier AI',
            toloka:         'Toloka',
            remotasks:      'Remotasks',
            textbroker:     'Textbroker',
        };

        for (const [key, label] of Object.entries(map)) {
            const r = results[key];
            if (!r) continue;
            const icon = {
                already_registered:          '✅',
                already_logged_in:           '✅',
                logged_in:                   '✅',
                registered:                  '🆕',
                pending_email_verification:  '📧',
                waiting_user_login:          '👤',
                error:                       '❌',
            }[r.status] || '❓';
            lines.push(`${icon} ${label}: ${r.status}${r.message ? ` (${r.message})` : ''}`);
        }

        return lines.join('\n');
    }
}

module.exports = new PlatformSetup();
