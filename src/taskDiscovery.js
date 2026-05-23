/**
 * taskDiscovery.js
 * ================
 * Menemukan peluang penghasilan online yang 100% bisa dikerjakan
 * secara otonom oleh AI agent tanpa perlu telepon atau video call.
 *
 * Target: $10 / 8 jam = $1.25/jam minimum.
 *
 * Prioritas platform (dari paling mudah otonom ke paling kompleks):
 *   Tier 1 — Microtask langsung (tidak perlu apply, bayar per task)
 *   Tier 2 — Freelance content/writing (perlu login, apply, tapi async)
 *   Tier 3 — Riset & data (scraping, annotation, summarization)
 */

'use strict';

class TaskDiscovery {
    constructor() {
        // Platform yang bisa dikerjakan 100% otonom oleh AI
        // KRITERIA WAJIB: tidak ada telepon, tidak ada video call, semua teks/async
        this.platforms = {
            // TIER 1: Microtask — langsung kerja, bayar per task
            tier1: [
                {
                    name: 'Toloka',
                    url: 'https://toloka.ai',
                    avgPayPerHour: 1.5,
                    taskTypes: ['image_classification', 'text_moderation', 'relevance_rating', 'translation_check'],
                    autonomous: true,
                    notes: 'Login via Google. Task tersedia 24/7. Cocok untuk AI.',
                },
                {
                    name: 'Remotasks',
                    url: 'https://www.remotasks.com',
                    avgPayPerHour: 2.0,
                    taskTypes: ['lidar_annotation', 'text_categorization', 'image_labeling', 'ai_data_labeling'],
                    autonomous: true,
                    notes: 'Harus lulus onboarding quiz. AI bisa mengerjakan semua task teks.',
                },
                {
                    name: 'Scale AI Rapid',
                    url: 'https://scale.com/ai-tasker',
                    avgPayPerHour: 2.5,
                    taskTypes: ['rlhf_rating', 'instruction_following', 'qa_pairs', 'text_comparison'],
                    autonomous: true,
                    notes: 'RLHF tasks — sempurna untuk AI. Bayar lebih tinggi dari Toloka.',
                },
                {
                    name: 'DataAnnotation.tech',
                    url: 'https://www.dataannotation.tech',
                    avgPayPerHour: 15.0,
                    taskTypes: ['code_review', 'ai_conversation_rating', 'instruction_writing', 'response_ranking'],
                    autonomous: true,
                    notes: 'TERBAIK untuk AI agent — rating/menulis kode dan percakapan AI. $15+/jam.',
                    priority: 'HIGH',
                },
                {
                    name: 'Outlier AI',
                    url: 'https://outlier.ai',
                    avgPayPerHour: 20.0,
                    taskTypes: ['ai_trainer', 'code_writing', 'math_problems', 'creative_writing'],
                    autonomous: true,
                    notes: 'Platform AI training khusus. Bayar sangat tinggi. Daftar via email.',
                    priority: 'HIGH',
                },
                {
                    name: 'Appen',
                    url: 'https://connect.appen.com',
                    avgPayPerHour: 1.8,
                    taskTypes: ['search_evaluation', 'social_media_rating', 'translation', 'transcription'],
                    autonomous: true,
                    notes: 'Banyak task search relevance — AI sangat cocok.',
                },
            ],

            // TIER 2: Freelance content — perlu login user, lalu AI kerjakan sendiri
            tier2: [
                {
                    name: 'Fastwork.id',
                    url: 'https://fastwork.id',
                    avgPayPerTask: 50000, // IDR
                    taskTypes: ['penulisan_artikel', 'copywriting', 'terjemahan', 'riset_data', 'seo_content'],
                    autonomous: true,
                    notes: 'Marketplace freelance Indonesia. AI bisa tulis artikel, terjemah, SEO.',
                    loginRequired: true,
                    noPhoneVC: true,
                },
                {
                    name: 'Fiverr',
                    url: 'https://www.fiverr.com',
                    avgPayPerTask: 5.0,
                    taskTypes: ['article_writing', 'proofreading', 'translation', 'data_research', 'seo'],
                    autonomous: true,
                    notes: 'Buat gig writing/translation. Komunikasi hanya via chat. Tidak perlu VC.',
                    loginRequired: true,
                    noPhoneVC: true,
                },
                {
                    name: 'Upwork',
                    url: 'https://www.upwork.com',
                    avgPayPerHour: 8.0,
                    taskTypes: ['data_entry', 'web_research', 'article_writing', 'virtual_assistant', 'translation'],
                    autonomous: true,
                    notes: 'Filter: "No video interview required". Apply via cover letter teks saja.',
                    loginRequired: true,
                    noPhoneVC: true,
                    filterStrategy: 'Cari job dengan badge "No video interview". Apply max 10 job/hari.',
                },
                {
                    name: 'PeoplePerHour',
                    url: 'https://www.peopleperhour.com',
                    avgPayPerHour: 6.0,
                    taskTypes: ['content_writing', 'data_analysis', 'research', 'translation'],
                    autonomous: true,
                    notes: 'Mirip Upwork tapi lebih kecil. Kontak via pesan teks saja.',
                    loginRequired: true,
                    noPhoneVC: true,
                },
                {
                    name: 'LinkedIn (Freelance)',
                    url: 'https://www.linkedin.com/jobs',
                    avgPayPerProject: 20.0,
                    taskTypes: ['content_writing', 'research', 'data_analysis', 'copywriting'],
                    autonomous: true,
                    notes: 'Cari "contract" atau "freelance" writing/research. Apply via Easy Apply.',
                    loginRequired: true,
                    noPhoneVC: false, // Perlu screening — filter hati-hati
                    filterStrategy: 'Cari "Easy Apply" + "Remote" + tidak ada syarat telepon di deskripsi.',
                },
            ],

            // TIER 3: Platform riset & konten khusus
            tier3: [
                {
                    name: 'Textbroker',
                    url: 'https://www.textbroker.com',
                    avgPayPer1000Words: 1.3,
                    taskTypes: ['article_writing', 'product_description', 'blog_post'],
                    autonomous: true,
                    notes: 'OpenOrder = kerja langsung tanpa apply. AI menulis, submit, dapat bayaran.',
                    loginRequired: true,
                    noPhoneVC: true,
                },
                {
                    name: 'iWriter',
                    url: 'https://www.iwriter.com',
                    avgPayPer500Words: 1.5,
                    taskTypes: ['article_writing', 'blog_post', 'product_review'],
                    autonomous: true,
                    notes: 'Platform penulisan artikel. Bayar per artikel. Tidak perlu interview.',
                    loginRequired: true,
                    noPhoneVC: true,
                },
                {
                    name: 'Clickworker',
                    url: 'https://www.clickworker.com',
                    avgPayPerHour: 1.2,
                    taskTypes: ['text_creation', 'categorization', 'web_research', 'proofreading'],
                    autonomous: true,
                    notes: 'Mirip Toloka. Task tersedia langsung setelah registrasi.',
                    loginRequired: true,
                    noPhoneVC: true,
                },
            ],
        };

        // Strategi fallback jika earning rate < target
        this.fallbackStrategies = [
            'switch_to_higher_paying_tier1',  // Coba DataAnnotation.tech / Outlier AI
            'parallel_platforms',              // Jalankan beberapa platform sekaligus
            'focus_on_content_writing',        // Textbroker + iWriter (banyak order tersedia)
            'apply_upwork_batch',              // Apply 10 job Upwork sekaligus
            'seek_new_platforms',              // Cari platform baru via pencarian browser
        ];
    }

    /**
     * Discover tasks — entry point utama yang dipanggil Hermes.
     * Mengembalikan daftar peluang yang diurutkan berdasarkan potensi $/jam.
     */
    async discoverTasks() {
        console.log('[TaskDiscovery] Memindai platform untuk peluang otonom...');

        const opportunities = [];

        // Tier 1: Microtask langsung
        for (const p of this.platforms.tier1) {
            opportunities.push({
                id: `TIER1-${p.name.toUpperCase().replace(/\s+/g, '-')}-${Date.now()}`,
                platform: p.name,
                tier: 1,
                url: p.url,
                title: p.taskTypes[0].replace(/_/g, ' '),
                taskTypes: p.taskTypes,
                estimatedPayPerHour: p.avgPayPerHour,
                payout: parseFloat((p.avgPayPerHour * 0.1).toFixed(2)), // per ~6 menit
                estTimeMins: 6,
                autonomous: p.autonomous,
                requiresPhone: false,
                requiresVC: false,
                loginRequired: p.loginRequired || false,
                notes: p.notes,
                priority: p.priority || 'NORMAL',
            });
        }

        // Tier 2: Freelance content
        for (const p of this.platforms.tier2) {
            if (p.noPhoneVC) {
                opportunities.push({
                    id: `TIER2-${p.name.toUpperCase().replace(/\s+/g, '-')}-${Date.now()}`,
                    platform: p.name,
                    tier: 2,
                    url: p.url,
                    title: `Freelance ${p.taskTypes[0].replace(/_/g, ' ')} di ${p.name}`,
                    taskTypes: p.taskTypes,
                    estimatedPayPerHour: p.avgPayPerHour || (p.avgPayPerTask / 1000) || 3.0,
                    payout: p.avgPayPerTask || p.avgPayPerHour || 5.0,
                    estTimeMins: 30,
                    autonomous: p.autonomous,
                    requiresPhone: false,
                    requiresVC: false,
                    loginRequired: p.loginRequired,
                    notes: p.notes,
                    filterStrategy: p.filterStrategy || null,
                    priority: 'NORMAL',
                });
            }
        }

        // Tier 3: Konten khusus
        for (const p of this.platforms.tier3) {
            opportunities.push({
                id: `TIER3-${p.name.toUpperCase()}-${Date.now()}`,
                platform: p.name,
                tier: 3,
                url: p.url,
                title: `${p.taskTypes[0].replace(/_/g, ' ')} di ${p.name}`,
                taskTypes: p.taskTypes,
                estimatedPayPerHour: p.avgPayPerHour || 2.0,
                payout: p.avgPayPer500Words || p.avgPayPer1000Words || p.avgPayPerHour * 0.5,
                estTimeMins: 20,
                autonomous: p.autonomous,
                requiresPhone: false,
                requiresVC: false,
                loginRequired: p.loginRequired,
                notes: p.notes,
                priority: 'NORMAL',
            });
        }

        return this.rankOpportunities(opportunities);
    }

    /**
     * Urutkan berdasarkan: priority HIGH dulu, lalu $/jam tertinggi,
     * lalu tidak butuh login (bisa langsung mulai).
     */
    rankOpportunities(opportunities) {
        return opportunities.sort((a, b) => {
            // HIGH priority dulu
            if (a.priority === 'HIGH' && b.priority !== 'HIGH') return -1;
            if (b.priority === 'HIGH' && a.priority !== 'HIGH') return 1;
            // Yang tidak butuh login dulu
            if (!a.loginRequired && b.loginRequired) return -1;
            if (a.loginRequired && !b.loginRequired) return 1;
            // Tertinggi $/jam
            return b.estimatedPayPerHour - a.estimatedPayPerHour;
        });
    }

    /**
     * Evaluasi apakah earning rate saat ini mencukupi target $1.25/jam.
     * Dipanggil oleh MCP evaluate_strategy.
     */
    evaluateProgress(totalEarned, elapsedMinutes) {
        const TARGET_PER_HOUR = 1.25; // $10 / 8 jam
        const SESSION_DURATION_HOURS = 8;
        const TARGET_TOTAL = 10.0;

        const elapsedHours = elapsedMinutes / 60;
        const currentRate = elapsedHours > 0 ? totalEarned / elapsedHours : 0;
        const projectedTotal = currentRate * SESSION_DURATION_HOURS;
        const remainingTarget = TARGET_TOTAL - totalEarned;
        const remainingHours = SESSION_DURATION_HOURS - elapsedHours;

        const onTrack = currentRate >= TARGET_PER_HOUR;
        const needStrategySwitch = !onTrack && elapsedMinutes >= 30; // Evaluasi setelah 30 menit

        return {
            totalEarned: totalEarned.toFixed(2),
            elapsedHours: elapsedHours.toFixed(2),
            currentRatePerHour: currentRate.toFixed(2),
            targetRatePerHour: TARGET_PER_HOUR.toFixed(2),
            projectedTotal: projectedTotal.toFixed(2),
            targetTotal: TARGET_TOTAL.toFixed(2),
            remainingTarget: remainingTarget.toFixed(2),
            remainingHours: remainingHours.toFixed(2),
            onTrack,
            needStrategySwitch,
            recommendation: needStrategySwitch
                ? `⚠ Rate $${currentRate.toFixed(2)}/jam KURANG dari target $${TARGET_PER_HOUR}/jam. GANTI STRATEGI: Coba DataAnnotation.tech atau Outlier AI yang bayarnya $15-20/jam.`
                : `✅ On track! Rate $${currentRate.toFixed(2)}/jam. Proyeksi: $${projectedTotal.toFixed(2)} dalam 8 jam.`,
        };
    }

    /** Dapatkan nama semua platform yang tersedia. */
    getAllPlatformNames() {
        const all = [
            ...this.platforms.tier1,
            ...this.platforms.tier2,
            ...this.platforms.tier3,
        ];
        return all.map(p => ({ name: p.name, url: p.url, tier: p.avgPayPerHour ? 1 : 2 }));
    }
}

module.exports = new TaskDiscovery();
