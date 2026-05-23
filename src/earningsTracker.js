/**
 * earningsTracker.js
 * ==================
 * Melacak penghasilan per task, per sesi 8 jam, dan per platform.
 * Menghitung earning rate aktual vs target $1.25/jam.
 */

'use strict';

const sqlite3          = require('sqlite3').verbose();
const path             = require('path');
const telegramNotifier = require('./telegramNotifier');

class EarningsTracker {
    constructor() {
        const dbDir  = path.join(__dirname, '..', '9router-data');
        const dbPath = path.join(dbDir, 'earnings.sqlite');

        // Pastikan folder ada
        const fs = require('fs');
        if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

        this.db = new sqlite3.Database(dbPath);
        this._initDb();

        this.sessionStartTime = Date.now();  // Jam mulai sesi ini
        this.SESSION_TARGET   = 10.0;        // $10 per sesi
        this.SESSION_HOURS    = 8;           // 8 jam
        this.TARGET_PER_HOUR  = this.SESSION_TARGET / this.SESSION_HOURS; // $1.25

        // Milestone yang sudah tercapai
        this.milestonesHit = new Set();
        this._checkInitialMilestones();
    }

    _initDb() {
        this.db.serialize(() => {
            // Tabel utama tasks
            this.db.run(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform     TEXT    NOT NULL,
                    task_id      TEXT    NOT NULL,
                    task_type    TEXT    DEFAULT 'unknown',
                    payout       REAL    NOT NULL,
                    session_date TEXT    DEFAULT (date('now')),
                    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // Tabel log strategi (kapan ganti platform)
            this.db.run(`
                CREATE TABLE IF NOT EXISTS strategy_log (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    from_platform TEXT,
                    to_platform   TEXT,
                    reason        TEXT,
                    earnings_at_switch REAL,
                    logged_at    DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
        });
    }

    _checkInitialMilestones() {
        this.getTotalEarnings()
            .then(total => {
                [1, 2, 5, 10].forEach(m => {
                    if (total >= m) this.milestonesHit.add(m);
                });
            })
            .catch(() => {});
    }

    /** Catat satu task yang selesai. */
    async logTask(platform, taskId, payout, taskType = 'unknown') {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO tasks (platform, task_id, task_type, payout)
                 VALUES (?, ?, ?, ?)`,
                [platform, taskId, taskType, payout],
                async err => {
                    if (err) {
                        console.error('[EarningsTracker] DB error:', err.message);
                        return reject(err);
                    }
                    console.log(`[EarningsTracker] +$${payout} dari ${platform} (${taskType})`);
                    await this._checkMilestones();
                    resolve();
                }
            );
        });
    }

    /** Catat pergantian strategi/platform. */
    async logStrategySwitch(fromPlatform, toPlatform, reason) {
        const total = await this.getTotalEarnings();
        return new Promise(resolve => {
            this.db.run(
                `INSERT INTO strategy_log (from_platform, to_platform, reason, earnings_at_switch)
                 VALUES (?, ?, ?, ?)`,
                [fromPlatform, toPlatform, reason, total],
                () => resolve()
            );
        });
    }

    /** Total penghasilan semua waktu. */
    getTotalEarnings() {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT COALESCE(SUM(payout), 0) as total FROM tasks`,
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row.total);
                }
            );
        });
    }

    /** Penghasilan sesi ini (sejak server start hari ini). */
    getSessionEarnings() {
        return new Promise((resolve, reject) => {
            this.db.get(
                `SELECT COALESCE(SUM(payout), 0) as total
                 FROM tasks
                 WHERE session_date = date('now')`,
                (err, row) => {
                    if (err) return reject(err);
                    resolve(row.total);
                }
            );
        });
    }

    /** Penghasilan per platform hari ini. */
    getEarningsByPlatform() {
        return new Promise((resolve, reject) => {
            this.db.all(
                `SELECT platform,
                        COUNT(*)        as task_count,
                        SUM(payout)     as total_payout
                 FROM tasks
                 WHERE session_date = date('now')
                 GROUP BY platform
                 ORDER BY total_payout DESC`,
                (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                }
            );
        });
    }

    /**
     * Dashboard lengkap — dipanggil oleh Hermes untuk evaluasi strategi.
     */
    async getSessionReport() {
        const sessionEarned  = await this.getSessionEarnings();
        const elapsedMs      = Date.now() - this.sessionStartTime;
        const elapsedHours   = elapsedMs / 3_600_000;
        const elapsedMinutes = elapsedMs / 60_000;
        const currentRate    = elapsedHours > 0 ? sessionEarned / elapsedHours : 0;
        const remainingHours = Math.max(0, this.SESSION_HOURS - elapsedHours);
        const projectedTotal = currentRate * this.SESSION_HOURS;
        const byPlatform     = await this.getEarningsByPlatform();

        const onTrack          = currentRate >= this.TARGET_PER_HOUR;
        const needStrategySwitch = !onTrack && elapsedMinutes >= 30;

        let statusIcon  = onTrack ? '✅' : '⚠';
        let recommendation = '';

        if (needStrategySwitch) {
            recommendation =
                `GANTI STRATEGI SEKARANG.\n` +
                `Rate saat ini: $${currentRate.toFixed(2)}/jam (butuh $${this.TARGET_PER_HOUR}/jam).\n` +
                `Coba: DataAnnotation.tech ($15/jam), Outlier AI ($20/jam), atau buka lebih banyak task Toloka/Remotasks sekaligus.`;
        } else if (onTrack) {
            recommendation = `Pertahankan strategi saat ini. Proyeksi: $${projectedTotal.toFixed(2)} dalam 8 jam.`;
        } else {
            recommendation = `Baru ${Math.floor(elapsedMinutes)} menit. Terus kerjakan, evaluasi lagi setelah 30 menit.`;
        }

        return {
            sessionEarned:        `$${sessionEarned.toFixed(2)}`,
            sessionTarget:        `$${this.SESSION_TARGET}`,
            elapsedHours:         elapsedHours.toFixed(2),
            remainingHours:       remainingHours.toFixed(2),
            currentRatePerHour:   `$${currentRate.toFixed(2)}`,
            targetRatePerHour:    `$${this.TARGET_PER_HOUR}/jam`,
            projectedTotal:       `$${projectedTotal.toFixed(2)}`,
            onTrack,
            needStrategySwitch,
            statusIcon,
            recommendation,
            earningsByPlatform:   byPlatform,
        };
    }

    async _checkMilestones() {
        try {
            const total = await this.getTotalEarnings();
            const milestones = [1, 2, 5, 10];

            for (const m of milestones) {
                if (total >= m && !this.milestonesHit.has(m)) {
                    this.milestonesHit.add(m);
                    const msg = m < 10
                        ? `💰 Milestone $${m} tercapai! Total: $${total.toFixed(2)}`
                        : `🎉 TARGET $10 TERCAPAI! Total: $${total.toFixed(2)}. Sesi berhasil!`;
                    await telegramNotifier.sendAlert(msg);
                    console.log(`[EarningsTracker] MILESTONE $${m}!`);
                }
            }
        } catch (err) {
            console.error('[EarningsTracker] Milestone check error:', err.message);
        }
    }
}

module.exports = new EarningsTracker();
