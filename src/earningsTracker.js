const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const telegramNotifier = require('./telegramNotifier');

class EarningsTracker {
    constructor() {
        const dbPath = path.join(__dirname, '..', '9router-data', 'earnings.sqlite');
        this.db = new sqlite3.Database(dbPath);
        this.initDb();

        // Track the current thresholds we have crossed to avoid spamming
        this.milestones = {
            5: false,
            10: false
        };

        this.checkInitialMilestones();
    }

    initDb() {
        this.db.serialize(() => {
            this.db.run(`
                CREATE TABLE IF NOT EXISTS tasks (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    platform TEXT NOT NULL,
                    task_id TEXT NOT NULL,
                    payout REAL NOT NULL,
                    completed_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
        });
    }

    checkInitialMilestones() {
        this.getTotalEarnings().then(total => {
            if (total >= 5) this.milestones[5] = true;
            if (total >= 10) this.milestones[10] = true;
        }).catch(err => console.error("EarningsTracker Init Error:", err));
    }

    async logTask(platform, taskId, payout) {
        return new Promise((resolve, reject) => {
            this.db.run(
                `INSERT INTO tasks (platform, task_id, payout) VALUES (?, ?, ?)`,
                [platform, taskId, payout],
                async (err) => {
                    if (err) {
                        console.error("Error logging task:", err);
                        return reject(err);
                    }
                    console.log(`[EarningsTracker] Logged task on ${platform} for $${payout}`);
                    await this.checkMilestones();
                    resolve();
                }
            );
        });
    }

    getTotalEarnings() {
        return new Promise((resolve, reject) => {
            this.db.get(`SELECT SUM(payout) as total FROM tasks`, (err, row) => {
                if (err) return reject(err);
                resolve(row.total || 0);
            });
        });
    }

    async checkMilestones() {
        try {
            const total = await this.getTotalEarnings();

            if (total >= 5 && !this.milestones[5]) {
                this.milestones[5] = true;
                await telegramNotifier.sendAlert(`💰 Milestone Reached: Total earnings have crossed $5! (Current: $${total.toFixed(2)})`);
            }

            if (total >= 10 && !this.milestones[10]) {
                this.milestones[10] = true;
                await telegramNotifier.sendAlert(`🎉 GOAL COMPLETED! Total earnings have reached $10! (Current: $${total.toFixed(2)})`);
            }
        } catch (err) {
            console.error("Error checking milestones:", err);
        }
    }
}

module.exports = new EarningsTracker();
