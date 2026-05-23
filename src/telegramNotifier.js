require('dotenv').config();

class TelegramNotifier {
    constructor() {
        this.token = process.env.TELEGRAM_BOT_TOKEN;
        this.chatId = process.env.TELEGRAM_CHAT_ID;
        this.lastUpdate = Date.now();
    }

    async sendAlert(message) {
        if (!this.token || !this.chatId) {
            console.warn(`[Telegram] Skipping alert (no token/chat ID): ${message}`);
            return;
        }

        try {
            const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.chatId,
                    text: message
                })
            });

            if (!response.ok) {
                console.error(`[Telegram] Failed to send message: ${response.statusText}`);
            } else {
                console.log(`[Telegram] Sent: ${message}`);
            }
        } catch (err) {
            console.error(`[Telegram] Error sending message:`, err);
        }
    }

    // Call this in the main loop to periodically send progress
    async checkPeriodicUpdate(currentEarnings) {
        const now = Date.now();
        const thirtyMins = 30 * 60 * 1000;

        if (now - this.lastUpdate >= thirtyMins) {
            await this.sendAlert(`📊 Progress Update: The agent is still running. Total earnings so far: $${currentEarnings.toFixed(2)}`);
            this.lastUpdate = now;
        }
    }
}

module.exports = new TelegramNotifier();
