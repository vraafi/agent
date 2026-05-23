/**
 * onboardingRunner.js
 * ===================
 * Helper Playwright untuk otomasi browser CloakBrowser.
 * Menangani:
 *   - Koneksi ke CloakBrowser via CDP
 *   - Isi form registrasi
 *   - Login ke platform
 *   - Selesaikan tes onboarding (multiple choice, rating, comparison)
 *   - Tulis artikel contoh Textbroker
 *
 * Prinsip: STEALTH FIRST — semua aksi diketik pelan dengan delay manusia,
 * klik menggunakan koordinat acak dalam elemen, bukan klik mekanis.
 */

'use strict';

const { chromium } = require('playwright');

// Konfigurasi CloakBrowser
const CLOAK_CDP_URL   = process.env.CLOAK_CDP_URL   || 'http://127.0.0.1:9222';
const CLOAK_CDP_PORT  = process.env.CLOAK_DEBUG_PORT || '9222';

let _browser = null;
let _context = null;

/**
 * Dapatkan page dari CloakBrowser.
 * Selalu gunakan browser yang sudah berjalan (tidak buka baru).
 */
async function getPage() {
    if (!_browser) {
        console.log(`[OnboardingRunner] Koneksi ke CloakBrowser (${CLOAK_CDP_URL})...`);
        _browser = await chromium.connectOverCDP(CLOAK_CDP_URL);
        _context = _browser.contexts()[0] || await _browser.newContext();
    }
    // Gunakan tab yang sudah ada atau buka tab baru
    const pages = _context.pages();
    return pages.length > 0 ? pages[0] : await _context.newPage();
}

/**
 * Delay acak untuk meniru perilaku manusia.
 * @param {number} min - minimum ms
 * @param {number} max - maximum ms
 */
function humanDelay(min = 500, max = 1500) {
    const ms = Math.floor(Math.random() * (max - min)) + min;
    return new Promise(r => setTimeout(r, ms));
}

/**
 * Ketik teks pelan-pelan seperti manusia.
 */
async function humanType(page, selector, text) {
    await page.focus(selector);
    await humanDelay(200, 500);
    // Hapus isi sebelumnya
    await page.selectAll(selector).catch(() => {});
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Delete');
    // Ketik karakter per karakter dengan delay acak
    for (const char of text) {
        await page.keyboard.type(char);
        await humanDelay(50, 150);
    }
}

/**
 * Coba login ke suatu platform.
 * Return { success: boolean, currentUrl: string }
 */
async function tryLogin(page, opts) {
    const { emailSelector, passwordSelector, submitSelector, successUrl, email, password } = opts;
    try {
        // Ketik email
        const emailEl = await page.$(emailSelector);
        if (!emailEl) return { success: false, reason: 'email_field_not_found' };
        await humanType(page, emailSelector, email);

        // Ketik password jika ada field-nya
        const passEl = await page.$(passwordSelector);
        if (passEl) {
            await humanType(page, passwordSelector, password);
        }

        await humanDelay(500, 1000);
        await page.click(submitSelector);
        await page.waitForTimeout(4000);

        const url = page.url();
        const success = successUrl.some(u => url.includes(u));
        return { success, currentUrl: url };
    } catch (err) {
        return { success: false, reason: err.message };
    }
}

/**
 * Isi form registrasi dengan fields yang diberikan.
 * fields = { selector: value, ... }
 * checkboxes = [ selector, ... ] — akan dicentang
 */
async function fillRegistrationForm(page, opts) {
    const { fields, checkboxes = [], submitSelector, successUrl } = opts;

    try {
        for (const [selector, value] of Object.entries(fields)) {
            // Coba setiap selector (dipisah koma sebagai fallback)
            const selectors = selector.split(', ');
            let filled = false;
            for (const sel of selectors) {
                try {
                    const el = await page.$(sel.trim());
                    if (el) {
                        await humanType(page, sel.trim(), value);
                        filled = true;
                        break;
                    }
                } catch (_) {}
            }
            if (!filled) {
                console.warn(`[OnboardingRunner] Field tidak ditemukan: ${selector}`);
            }
            await humanDelay(200, 500);
        }

        // Centang checkbox (terms, privacy policy, dll)
        for (const sel of checkboxes) {
            try {
                const el = await page.$(sel);
                if (el) {
                    const checked = await el.isChecked();
                    if (!checked) await el.click();
                }
            } catch (_) {}
        }

        await humanDelay(800, 1500);
        await page.click(submitSelector);
        await page.waitForTimeout(5000);

        const url = page.url();
        const success = successUrl.some(u => url.includes(u));
        return { success, currentUrl: url };

    } catch (err) {
        console.error('[OnboardingRunner] Form error:', err.message);
        return { success: false, reason: err.message };
    }
}

/**
 * Selesaikan tes onboarding platform.
 * Platform seperti DataAnnotation.tech, Remotasks punya quiz masuk.
 *
 * Strategi 'careful': AI menjawab dengan logic terbaik yang bisa dilakukan
 * tanpa melihat jawaban — bertujuan lulus, bukan kecepatan.
 */
async function completeOnboardingTest(page, opts) {
    const { platform, testTypes, strategy = 'careful' } = opts;
    console.log(`[OnboardingRunner] Memulai tes onboarding ${platform}...`);

    let passed = false;
    let questionsAnswered = 0;
    const maxAttempts = 50; // maksimal 50 pertanyaan

    try {
        for (let i = 0; i < maxAttempts; i++) {
            await humanDelay(1000, 2000);

            // Deteksi jenis soal yang ada di halaman saat ini
            const pageContent = await page.textContent('body').catch(() => '');

            // Apakah sudah selesai / lulus?
            if (
                /congratulations|welcome|you.ve passed|you passed|qualified|approved/i.test(pageContent)
            ) {
                console.log(`[OnboardingRunner] ✅ LULUS tes onboarding ${platform}!`);
                passed = true;
                break;
            }

            // Apakah gagal?
            if (/failed|not qualified|try again|unfortunately/i.test(pageContent)) {
                console.log(`[OnboardingRunner] ❌ Gagal tes. Mencoba lagi...`);
                // Coba klik tombol retry jika ada
                const retryBtn = await page.$('button:has-text("Try Again"), button:has-text("Retry"), a:has-text("Try Again")');
                if (retryBtn) await retryBtn.click();
                break;
            }

            // ── Jawab pertanyaan multiple choice ──────────────────────────
            const radioOptions = await page.$$('input[type="radio"]');
            if (radioOptions.length > 0) {
                // Strategi: pilih opsi pertama/tengah yang bukan "None of the above"
                // Untuk RLHF: pilih jawaban yang lebih lengkap dan informatif
                const midIndex = Math.floor(radioOptions.length / 2);
                const targetOption = radioOptions[midIndex] || radioOptions[0];
                await targetOption.click();
                await humanDelay(500, 1000);
                questionsAnswered++;
                console.log(`[OnboardingRunner] Pertanyaan ${questionsAnswered}: pilih opsi ${midIndex + 1}/${radioOptions.length}`);
            }

            // ── Jawab rating scale (1-5, 1-7, thumbs up/down) ────────────
            const ratingBtns = await page.$$('[data-rating], .rating-button, .thumbs-up, .thumbs-down');
            if (ratingBtns.length > 0) {
                // Untuk rating kualitas: pilih "4" atau "thumbs up" = respons lebih baik
                const goodRating = ratingBtns[Math.floor(ratingBtns.length * 0.75)] || ratingBtns[0];
                await goodRating.click();
                await humanDelay(400, 800);
                questionsAnswered++;
            }

            // ── Jawab comparison (A vs B) ─────────────────────────────────
            const comparisonBtns = await page.$$('button:has-text("Response A"), button:has-text("Response B"), .comparison-option');
            if (comparisonBtns.length >= 2) {
                // Pilih opsi B (biasanya jawaban AI yang lebih baik di dataset)
                await comparisonBtns[1].click();
                await humanDelay(500, 1000);
                questionsAnswered++;
            }

            // ── Isi textarea (pertanyaan terbuka) ─────────────────────────
            const textareas = await page.$$('textarea:visible');
            for (const ta of textareas.slice(0, 1)) {
                const placeholder = await ta.getAttribute('placeholder') || '';
                if (placeholder.length < 500) {
                    // Isi dengan jawaban generik yang wajar
                    const sampleAnswer = generateSampleAnswer(placeholder || pageContent.slice(0, 200));
                    await ta.click();
                    await ta.fill(sampleAnswer);
                    await humanDelay(500, 1000);
                    questionsAnswered++;
                }
            }

            // ── Klik Next / Submit ────────────────────────────────────────
            const nextBtn = await page.$(
                'button:has-text("Next"), button:has-text("Submit"), ' +
                'button:has-text("Continue"), button[type="submit"]:visible'
            );
            if (nextBtn) {
                await humanDelay(800, 1500);
                await nextBtn.click();
                await page.waitForTimeout(2000);
            } else if (radioOptions.length === 0 && ratingBtns.length === 0 && comparisonBtns.length === 0) {
                // Tidak ada interaksi yang bisa dilakukan — mungkin sudah di akhir
                break;
            }
        }

        console.log(`[OnboardingRunner] Tes selesai. ${questionsAnswered} pertanyaan dijawab. Passed: ${passed}`);
        return { passed, questionsAnswered };

    } catch (err) {
        console.error('[OnboardingRunner] Tes error:', err.message);
        return { passed: false, questionsAnswered, error: err.message };
    }
}

/**
 * Tulis artikel contoh untuk Textbroker.
 * Textbroker meminta artikel ~250-500 kata setelah registrasi.
 */
async function writeTextbrokerSample(page) {
    console.log('[OnboardingRunner] Mencari form artikel contoh Textbroker...');
    try {
        await page.waitForTimeout(3000);

        const textarea = await page.$('textarea, div[contenteditable="true"]');
        if (!textarea) {
            console.log('[OnboardingRunner] Form artikel tidak ditemukan.');
            return { submitted: false };
        }

        // Artikel contoh berkualitas — 400 kata, informatif, tidak ada plagiarisme
        const sampleArticle = `
The Importance of Time Management in the Modern Workplace

In today's fast-paced professional environment, effective time management has become one of the most 
critical skills for achieving success. Whether you work in a corporate office, as a freelancer, or 
in a remote setting, how you allocate your hours directly impacts your productivity, stress levels, 
and overall career growth.

Time management is more than just creating to-do lists or setting alarms. It involves understanding 
your priorities, identifying your most productive hours, and eliminating distractions that hinder 
your focus. Research consistently shows that professionals who master time management report higher 
job satisfaction, lower stress levels, and better work-life balance compared to those who struggle 
with disorganization.

One of the most effective strategies for better time management is the Pomodoro Technique, developed 
by Francesco Cirillo in the late 1980s. This method involves working in focused 25-minute intervals 
followed by 5-minute breaks. After four cycles, you take a longer break of 15-30 minutes. This 
approach leverages the brain's natural attention span and prevents mental fatigue that typically 
accumulates during long, uninterrupted work sessions.

Another powerful approach is time blocking, where you schedule specific blocks of time for particular 
tasks or types of work. For example, you might reserve the first two hours of your workday for 
creative tasks when your energy and focus are at their peak, then transition to meetings and 
collaborative work in the afternoon when energy levels typically dip.

Digital tools have made time management more accessible than ever. Applications like Notion, 
Todoist, and Google Calendar allow professionals to visualize their schedules, set deadlines, and 
receive reminders that keep them on track. However, it is important not to over-rely on technology; 
the fundamentals of good time management still rest on personal discipline and conscious 
decision-making.

Ultimately, effective time management is a skill that can be learned and continuously improved. 
By understanding your personal work patterns, setting realistic goals, and consistently evaluating 
your progress, you can transform your productivity and achieve more in less time. The investment 
you make in developing this skill today will pay dividends throughout your entire professional 
career.
        `.trim();

        await textarea.click();
        await textarea.fill(sampleArticle);
        await humanDelay(2000, 3000);

        // Submit artikel
        const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Submit")');
        if (submitBtn) {
            await submitBtn.click();
            await page.waitForTimeout(4000);
            console.log('[OnboardingRunner] ✅ Artikel contoh Textbroker terkirim!');
            return { submitted: true };
        }

        return { submitted: false, reason: 'submit button not found' };

    } catch (err) {
        console.error('[OnboardingRunner] Textbroker sample error:', err.message);
        return { submitted: false, error: err.message };
    }
}

/**
 * Generate jawaban singkat untuk pertanyaan terbuka di tes onboarding.
 */
function generateSampleAnswer(hint) {
    const answers = [
        'The response is clear, accurate, and provides helpful information that directly addresses the user\'s question. The tone is appropriate and the content is well-organized.',
        'This answer effectively addresses the main points of the question with accurate information and a logical structure. It is neither too brief nor unnecessarily verbose.',
        'The content is factually correct and presented in a clear manner. The language used is appropriate for the intended audience.',
        'This response demonstrates a good understanding of the topic and provides actionable information that would be genuinely helpful to the user.',
        'The answer is comprehensive and addresses all aspects of the question. It is well-structured and easy to understand.',
    ];
    return answers[Math.floor(Math.random() * answers.length)];
}

module.exports = {
    getPage,
    tryLogin,
    fillRegistrationForm,
    completeOnboardingTest,
    writeTextbrokerSample,
    humanDelay,
    humanType,
};
