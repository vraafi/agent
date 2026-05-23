/**
 * taskDiscovery.js — Strategi $0 Modal
 * =====================================
 * SEMUA platform di sini gratis 100% untuk bergabung dan mulai bekerja.
 * Tidak ada biaya pendaftaran, tidak ada subscription, tidak ada modal.
 *
 * Kriteria platform yang masuk daftar ini:
 *   ✅ Gratis daftar ($0)
 *   ✅ Bisa dikerjakan AI 100% otonom
 *   ✅ Tidak butuh telepon / video call
 *   ✅ Pembayaran via PayPal atau Payoneer (keduanya gratis dibuat)
 *   ✅ Bisa mulai hari ini tanpa menunggu approval berbulan-bulan
 *
 * Target: $10 / 8 jam = $1.25/jam minimum.
 */

'use strict';

class TaskDiscovery {
    constructor() {
        /**
         * PLATFORM TIER 1 — Microtask Langsung
         * Tidak perlu apply, tidak perlu nunggu client, langsung kerja = langsung bayar.
         * INI ADALAH PRIORITAS UTAMA dengan modal $0.
         */
        this.tier1 = [
            {
                name: 'DataAnnotation.tech',
                url: 'https://www.dataannotation.tech',
                costToJoin: 0,
                avgPayPerHour: 15,
                withdrawal: 'PayPal (gratis)',
                taskTypes: [
                    'rating_respons_ai',      // "Mana jawaban AI yang lebih baik?"
                    'menulis_instruksi',       // Tulis instruksi untuk AI
                    'review_kode_ai',          // Review kode yang ditulis AI
                    'percakapan_ai',           // Tulis percakapan/skenario untuk melatih AI
                ],
                howToStart: 'Daftar email → tes singkat (bisa dikerjakan AI) → langsung dapat task',
                autonomous: true,
                priority: 1,
                notes: 'TERBAIK untuk AI agent. Task = melatih AI lain. Bayar $15/jam rata-rata.',
            },
            {
                name: 'Outlier AI',
                url: 'https://outlier.ai',
                costToJoin: 0,
                avgPayPerHour: 20,
                withdrawal: 'Stripe (gratis)',
                taskTypes: [
                    'ai_trainer',              // Latih model AI
                    'menulis_kode',            // Tulis kode yang diminta
                    'soal_matematika',         // Jawab soal matematika
                    'creative_writing',        // Penulisan kreatif
                ],
                howToStart: 'Daftar email → tes keahlian → task langsung tersedia',
                autonomous: true,
                priority: 1,
                notes: 'Bayar TERTINGGI ($20+/jam). Cocok sempurna untuk AI. Sering butuh AI trainer.',
            },
            {
                name: 'Toloka',
                url: 'https://toloka.ai',
                costToJoin: 0,
                avgPayPerHour: 1.5,
                withdrawal: 'PayPal / Payoneer (keduanya gratis)',
                taskTypes: [
                    'klasifikasi_gambar',      // Ini foto apa?
                    'moderasi_teks',           // Apakah konten ini aman?
                    'rating_relevansi',        // Apakah hasil pencarian relevan?
                    'cek_terjemahan',          // Terjemahan ini benar?
                    'jawab_pertanyaan',        // Jawab pertanyaan sederhana
                ],
                howToStart: 'Login Google → langsung ada ratusan task tersedia 24/7',
                autonomous: true,
                priority: 2,
                notes: 'Volume task sangat banyak. Bisa kerjakan 50-100 task/jam. Bayar kecil tapi stabil.',
            },
            {
                name: 'Remotasks',
                url: 'https://www.remotasks.com',
                costToJoin: 0,
                avgPayPerHour: 2,
                withdrawal: 'PayPal (gratis)',
                taskTypes: [
                    'anotasi_teks',            // Tandai entitas dalam teks
                    'kategorisasi',            // Kategorikan item ini
                    'anotasi_gambar',          // Gambar kotak di sekitar objek
                    'ai_data_labeling',        // Label data untuk AI
                ],
                howToStart: 'Daftar email → lulus onboarding quiz (singkat, bisa AI jawab) → kerja',
                autonomous: true,
                priority: 2,
                notes: 'Quiz onboarding bisa dilewati AI. Task tersedia banyak. Bayar mingguan.',
            },
            {
                name: 'Scale AI (Rapid)',
                url: 'https://scale.com/ai-tasker',
                costToJoin: 0,
                avgPayPerHour: 2.5,
                withdrawal: 'PayPal (gratis)',
                taskTypes: [
                    'rlhf_rating',             // Bandingkan 2 jawaban AI
                    'instruction_following',   // Ikuti instruksi dan nilai hasilnya
                    'qa_pairs',                // Buat pasangan pertanyaan-jawaban
                    'text_comparison',         // Bandingkan 2 teks
                ],
                howToStart: 'Daftar email → verifikasi → task tersedia via dashboard',
                autonomous: true,
                priority: 2,
                notes: 'RLHF task — sangat cocok untuk AI. Bayar lebih dari Toloka.',
            },
            {
                name: 'Appen',
                url: 'https://connect.appen.com',
                costToJoin: 0,
                avgPayPerHour: 1.8,
                withdrawal: 'PayPal / bank transfer (gratis)',
                taskTypes: [
                    'evaluasi_pencarian',      // Apakah hasil Google ini relevan?
                    'rating_media_sosial',     // Rating konten media sosial
                    'transkripsi',             // Transkrip audio pendek
                    'terjemahan',              // Terjemah teks pendek
                ],
                howToStart: 'Daftar → tes bahasa Inggris → apply ke project → kerja',
                autonomous: true,
                priority: 3,
                notes: 'Project bisa berbulan-bulan. Stabil tapi butuh approval dulu.',
            },
            {
                name: 'Clickworker',
                url: 'https://www.clickworker.com',
                costToJoin: 0,
                avgPayPerHour: 1.2,
                withdrawal: 'PayPal / SEPA (gratis)',
                taskTypes: [
                    'pembuatan_teks',          // Tulis teks pendek
                    'kategorisasi',            // Kategorikan produk/item
                    'riset_web',               // Cari info spesifik di web
                    'proofreading',            // Periksa ejaan/tata bahasa
                ],
                howToStart: 'Daftar email → tes → task langsung tersedia',
                autonomous: true,
                priority: 3,
                notes: 'Jumlah task fluktuatif. Bayar rendah tapi tidak perlu modal apapun.',
            },
        ];

        /**
         * PLATFORM TIER 2 — Penulisan Konten
         * Gratis daftar, langsung ambil order tanpa menunggu client.
         * Cocok untuk AI yang bisa menulis artikel berkualitas.
         */
        this.tier2 = [
            {
                name: 'Textbroker',
                url: 'https://www.textbroker.com',
                costToJoin: 0,
                avgPayPer1000Words: 1.3,  // Level 3
                avgPayPerHour: 3,
                withdrawal: 'PayPal (gratis, minimal $10)',
                taskTypes: [
                    'artikel_blog',
                    'deskripsi_produk',
                    'konten_website',
                    'press_release',
                ],
                howToStart: 'Daftar → tulis contoh artikel → dapat level rating → ambil OpenOrder langsung',
                autonomous: true,
                priority: 2,
                notes: 'OpenOrder = ratusan artikel tersedia, langsung ambil & tulis tanpa menunggu. $0 modal.',
            },
            {
                name: 'iWriter',
                url: 'https://www.iwriter.com',
                costToJoin: 0,
                avgPayPer500Words: 1.5,
                avgPayPerHour: 2.5,
                withdrawal: 'PayPal (gratis, minimal $20)',
                taskTypes: [
                    'artikel_blog',
                    'review_produk',
                    'konten_seo',
                ],
                howToStart: 'Daftar → langsung lihat dan ambil order tersedia → tulis → submit',
                autonomous: true,
                priority: 2,
                notes: 'Sistem mirip Textbroker. Banyak order tersedia. AI bisa kerjakan semua.',
            },
        ];

        /**
         * PLATFORM TIER 3 — Freelance (Butuh Login User, Lalu AI Otonom)
         * Gratis daftar. Butuh login dari user, setelah itu AI kerjakan sendiri.
         * Lebih lambat (perlu dapat order), tapi bayar lebih tinggi per project.
         *
         * CATATAN: Upwork sekarang gratis apply (tidak perlu beli connects).
         * Fiverr gratis buat gig tapi perlu waktu untuk dapat order pertama.
         */
        this.tier3 = [
            {
                name: 'Fastwork.id',
                url: 'https://fastwork.id',
                costToJoin: 0,
                avgPayPerProject: 75000, // IDR ~$5
                withdrawal: 'Transfer bank lokal (gratis)',
                taskTypes: [
                    'penulisan_artikel',
                    'copywriting',
                    'terjemahan_id_en',
                    'riset_data',
                    'penulisan_konten_media_sosial',
                ],
                howToStart: 'Login user → AI buat profil & listing → tunggu order atau lamar job tersedia',
                autonomous: true,
                loginRequired: true,
                noPhoneVC: true,
                priority: 3,
                notes: 'Platform Indonesia. Tidak ada VC/telepon. Semua komunikasi via chat teks.',
            },
            {
                name: 'Fiverr',
                url: 'https://www.fiverr.com',
                costToJoin: 0,
                avgPayPerGig: 5,
                withdrawal: 'PayPal (gratis, tapi ada 14 hari clearing)',
                taskTypes: [
                    'penulisan_artikel',
                    'terjemahan',
                    'proofreading',
                    'riset_data',
                    'penulisan_konten_seo',
                ],
                howToStart: 'Login user → AI buat gig menarik → tunggu buyer (bisa lama untuk baru)',
                autonomous: true,
                loginRequired: true,
                noPhoneVC: true,
                priority: 3,
                notes: 'Gratis tapi slow start — susah dapat order pertama tanpa review. Lebih cocok jangka panjang.',
                realism: 'Tidak realistis untuk target $10 hari ini jika akun baru.',
            },
        ];

        // Semua platform digabung
        this.allPlatforms = [...this.tier1, ...this.tier2, ...this.tier3];

        // Konstanta target
        this.TARGET_TOTAL    = 10.0;
        this.SESSION_HOURS   = 8;
        this.TARGET_PER_HOUR = this.TARGET_TOTAL / this.SESSION_HOURS; // $1.25
    }

    /**
     * Entry point utama — return semua peluang diranking dari yang paling realistis
     * untuk modal $0 dan kondisi hari ini.
     */
    async discoverTasks() {
        console.log('[TaskDiscovery] Memindai platform $0 modal...');

        const opportunities = [];

        // Tier 1: Microtask langsung
        for (const p of this.tier1) {
            opportunities.push({
                id:                    `T1-${p.name.replace(/\s+/g, '')}-${Date.now()}`,
                platform:              p.name,
                tier:                  1,
                url:                   p.url,
                costToJoin:            0,
                taskTypes:             p.taskTypes,
                title:                 `${p.taskTypes[0].replace(/_/g, ' ')} (${p.name})`,
                estimatedPayPerHour:   p.avgPayPerHour,
                payout:                parseFloat((p.avgPayPerHour * 0.1).toFixed(2)),
                estTimeMins:           6,
                withdrawal:            p.withdrawal,
                howToStart:            p.howToStart,
                autonomous:            true,
                requiresPhone:         false,
                requiresVC:            false,
                loginRequired:         false,
                priority:              p.priority,
                notes:                 p.notes,
            });
        }

        // Tier 2: Penulisan konten
        for (const p of this.tier2) {
            opportunities.push({
                id:                    `T2-${p.name.replace(/\s+/g, '')}-${Date.now()}`,
                platform:              p.name,
                tier:                  2,
                url:                   p.url,
                costToJoin:            0,
                taskTypes:             p.taskTypes,
                title:                 `Penulisan artikel (${p.name})`,
                estimatedPayPerHour:   p.avgPayPerHour,
                payout:                p.avgPayPer500Words || p.avgPayPer1000Words || 1.5,
                estTimeMins:           20,
                withdrawal:            p.withdrawal,
                howToStart:            p.howToStart,
                autonomous:            true,
                requiresPhone:         false,
                requiresVC:            false,
                loginRequired:         false,
                priority:              p.priority,
                notes:                 p.notes,
            });
        }

        // Tier 3: Freelance (butuh login user)
        for (const p of this.tier3) {
            if (p.noPhoneVC) {
                opportunities.push({
                    id:                  `T3-${p.name.replace(/\s+/g, '')}-${Date.now()}`,
                    platform:            p.name,
                    tier:                3,
                    url:                 p.url,
                    costToJoin:          0,
                    taskTypes:           p.taskTypes,
                    title:               `Freelance ${p.taskTypes[0].replace(/_/g, ' ')} (${p.name})`,
                    estimatedPayPerHour: 3,
                    payout:              p.avgPayPerGig || 5,
                    estTimeMins:         30,
                    withdrawal:          p.withdrawal,
                    howToStart:          p.howToStart,
                    autonomous:          true,
                    requiresPhone:       false,
                    requiresVC:          false,
                    loginRequired:       true,
                    priority:            p.priority,
                    notes:               p.notes,
                    realism:             p.realism || null,
                });
            }
        }

        return this._rank(opportunities);
    }

    /** Rank: priority ASC, lalu $/jam DESC, lalu loginRequired ASC */
    _rank(list) {
        return list.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (a.estimatedPayPerHour !== b.estimatedPayPerHour)
                return b.estimatedPayPerHour - a.estimatedPayPerHour;
            return Number(a.loginRequired) - Number(b.loginRequired);
        });
    }

    /** Evaluasi apakah perlu ganti strategi berdasarkan rate saat ini. */
    evaluateProgress(totalEarned, elapsedMinutes) {
        const elapsedHours   = elapsedMinutes / 60;
        const currentRate    = elapsedHours > 0 ? totalEarned / elapsedHours : 0;
        const projectedTotal = currentRate * this.SESSION_HOURS;
        const onTrack        = currentRate >= this.TARGET_PER_HOUR;
        const needSwitch     = !onTrack && elapsedMinutes >= 30;

        return {
            totalEarned:      totalEarned.toFixed(2),
            currentRate:      currentRate.toFixed(2),
            targetRate:       this.TARGET_PER_HOUR.toFixed(2),
            projectedTotal:   projectedTotal.toFixed(2),
            onTrack,
            needSwitch,
            message: needSwitch
                ? `⚠ $${currentRate.toFixed(2)}/jam < target $${this.TARGET_PER_HOUR}/jam. GANTI KE DataAnnotation.tech atau Outlier AI.`
                : onTrack
                    ? `✅ On track. Proyeksi: $${projectedTotal.toFixed(2)}`
                    : `Masih awal — evaluasi lagi setelah 30 menit.`,
        };
    }

    /** Return ringkasan semua platform (nama + URL + $/jam + $0 modal). */
    getPlatformSummary() {
        return this.allPlatforms.map(p => ({
            name:    p.name,
            url:     p.url,
            payHour: p.avgPayPerHour || '~2-3',
            cost:    '$0',
            login:   p.loginRequired ? 'Butuh login user' : 'Daftar sendiri',
        }));
    }
}

module.exports = new TaskDiscovery();
