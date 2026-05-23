#!/usr/bin/env bash
# =============================================================================
# hermes-money-setup.sh
# =============================================================================
# Setup SATU KALI untuk HermesMoneyAgent.
#
# Apa yang dilakukan script ini:
#   1. Tulis ~/.hermes/config.yaml — aktifkan Telegram gateway + busy_input_mode steer
#   2. Tulis ~/.hermes/.env — token dan secrets
#   3. Buat cron job Hermes untuk evaluasi earning setiap 30 menit
#   4. Daftarkan MCP server kita ke konfigurasi Hermes
#
# Jalankan SEKALI sebelum menjalankan agent pertama kali:
#   bash scripts/hermes-money-setup.sh
# =============================================================================

set -euo pipefail

# ─── Warna untuk output ──────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
err()  { echo -e "${RED}❌ $*${NC}"; }

echo ""
echo "══════════════════════════════════════════════════════"
echo "  HermesMoneyAgent — Setup Telegram Gateway + Cron"
echo "══════════════════════════════════════════════════════"
echo ""

# ─── Variabel yang dibutuhkan ─────────────────────────────────────────────────
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
HERMES_AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)/hermes-agent"
NODE_DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/9router-data"
MCP_SERVER="$(cd "$(dirname "$0")/.." && pwd)/src/mcp_server.js"
NINEROUTER_URL="${NINEROUTER_URL:-http://127.0.0.1:8080}"
HERMES_MODEL="${HERMES_MODEL:-kr/claude-sonnet-4.5}"

# Baca dari env atau minta input
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"
PLATFORM_EMAIL="${PLATFORM_EMAIL:-}"
PLATFORM_PASSWORD="${PLATFORM_PASSWORD:-}"

echo "Direktori Hermes home: $HERMES_HOME"
echo "Direktori hermes-agent: $HERMES_AGENT_DIR"
echo ""

# ─── Validasi env vars ────────────────────────────────────────────────────────
if [[ -z "$TELEGRAM_BOT_TOKEN" ]]; then
    warn "TELEGRAM_BOT_TOKEN belum diset."
    echo "  Cara dapat: Buat bot di @BotFather di Telegram (gratis, 2 menit)"
    echo "  Lalu: export TELEGRAM_BOT_TOKEN=1234567890:ABCdef..."
    read -p "  Masukkan Bot Token sekarang (atau Enter untuk skip): " TELEGRAM_BOT_TOKEN
fi

if [[ -z "$TELEGRAM_CHAT_ID" ]]; then
    warn "TELEGRAM_CHAT_ID belum diset."
    echo "  Cara dapat: Kirim pesan ke bot kamu, lalu buka:"
    echo "  https://api.telegram.org/bot<TOKEN>/getUpdates"
    echo "  Cari 'chat':{'id': ANGKA} — angka itu adalah Chat ID kamu"
    read -p "  Masukkan Chat ID sekarang (atau Enter untuk skip): " TELEGRAM_CHAT_ID
fi

# ─── 1. Buat direktori Hermes home ───────────────────────────────────────────
echo ""
echo "[1/4] Membuat direktori ~/.hermes..."
mkdir -p "$HERMES_HOME"
mkdir -p "$HERMES_HOME/cron/output"
mkdir -p "$HERMES_HOME/skins"
ok "Direktori siap: $HERMES_HOME"

# ─── 2. Tulis ~/.hermes/.env ──────────────────────────────────────────────────
echo ""
echo "[2/4] Menulis ~/.hermes/.env..."

cat > "$HERMES_HOME/.env" << ENVEOF
# HermesMoneyAgent — Secrets
# File ini dibaca oleh Hermes Agent, BUKAN dikirim ke 9Router.

TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
TELEGRAM_CHAT_ID=${TELEGRAM_CHAT_ID}
PLATFORM_EMAIL=${PLATFORM_EMAIL}
PLATFORM_PASSWORD=${PLATFORM_PASSWORD}

# 9Router endpoint (Kiro AI free → Gemini fallback)
OPENAI_BASE_URL=${NINEROUTER_URL}/v1
OPENAI_API_KEY=sk-9router-local

# CloakBrowser CDP
CLOAK_CDP_URL=http://127.0.0.1:9223
CLOAK_DEBUG_PORT=9223
ENVEOF

chmod 600 "$HERMES_HOME/.env"
ok "~/.hermes/.env tertulis"

# ─── 3. Tulis ~/.hermes/config.yaml ──────────────────────────────────────────
echo ""
echo "[3/4] Menulis ~/.hermes/config.yaml..."

cat > "$HERMES_HOME/config.yaml" << YAMLEOF
# HermesMoneyAgent — Konfigurasi Hermes Agent
# ============================================
# TELEGRAM GATEWAY: Aktif
#   Hermes menerima pesan dari Telegram secara langsung.
#   Kamu bisa kirim perintah ke bot Telegram sambil Hermes sedang bekerja.
#
# BUSY_INPUT_MODE: steer
#   Pesan yang dikirim saat Hermes sedang bekerja akan di-inject
#   ke dalam sesi SETELAH tool call berikutnya selesai.
#   Tidak ada interupsi mendadak — pesan masuk dengan mulus.

# ── Model ────────────────────────────────────────────────────────────────────
# Model dikonfigurasi via OPENAI_BASE_URL dan OPENAI_API_KEY di .env

# ── Telegram Gateway ─────────────────────────────────────────────────────────
# Hermes berjalan sebagai Telegram bot.
# Kirim pesan ke bot untuk berinteraksi langsung dengan agent.
platforms:
  telegram:
    bot_token: "\${TELEGRAM_BOT_TOKEN}"
    home_chat_id: "\${TELEGRAM_CHAT_ID}"
    # Hanya terima pesan dari chat_id kamu sendiri (keamanan)
    allowed_chat_ids:
      - "\${TELEGRAM_CHAT_ID}"
    # Kirim konfirmasi penerimaan pesan
    typing_indicator: true
    # Cleanup tool progress messages setelah selesai
    cleanup_progress: true

# ── Perilaku saat Hermes Sedang Bekerja ──────────────────────────────────────
display:
  # PALING PENTING: Pesan masuk saat Hermes bekerja di-inject setelah tool call berikutnya
  # Options: interrupt | queue | steer
  # "steer" = pesan masuk tanpa interupsi, agent baca setelah tool berikutnya selesai
  busy_input_mode: steer
  compact: true
  tool_progress: all
  streaming: true
  show_reasoning: false
  interim_assistant_messages: true
  # Bersihkan tool progress bubbles setelah respons final
  cleanup_progress: true

# ── Session Reset (Gateway) ───────────────────────────────────────────────────
# Reset konteks setelah 6 jam idle agar tidak membengkak
session_reset:
  mode: idle
  idle_minutes: 360

# ── Konteks Compression ───────────────────────────────────────────────────────
compression:
  enabled: true
  threshold: 0.50
  target_ratio: 0.20
  protect_last_n: 20
  protect_first_n: 3

# ── Memory ────────────────────────────────────────────────────────────────────
memory:
  memory_enabled: true
  user_profile_enabled: true
  memory_char_limit: 2200
  nudge_interval: 10
  flush_min_turns: 6

# ── Tool Loop Guardrails ──────────────────────────────────────────────────────
tool_loop_guardrails:
  warnings_enabled: true
  hard_stop_enabled: false
  warn_after:
    exact_failure: 2
    same_tool_failure: 3
    idempotent_no_progress: 2

# ── Terminal Backend ──────────────────────────────────────────────────────────
terminal:
  backend: local
  timeout: 180
  lifetime_seconds: 600

# ── Browser ───────────────────────────────────────────────────────────────────
browser:
  inactivity_timeout: 300

# ── Model Aliases ─────────────────────────────────────────────────────────────
model_aliases:
  kiro:
    model: "${HERMES_MODEL}"
    provider: custom
    base_url: "${NINEROUTER_URL}/v1"
  gemini:
    model: "google/gemini-1.5-pro"
    provider: custom
    base_url: "${NINEROUTER_URL}/v1"

# ── MCP Servers ───────────────────────────────────────────────────────────────
# Money-agent MCP server — tools untuk cari penghasilan online
mcp_servers:
  money-agent:
    command: node
    args:
      - "${MCP_SERVER}"
    env:
      TELEGRAM_BOT_TOKEN: "\${TELEGRAM_BOT_TOKEN}"
      TELEGRAM_CHAT_ID: "\${TELEGRAM_CHAT_ID}"
      CLOAK_CDP_URL: "\${CLOAK_CDP_URL}"
      CLOAK_DEBUG_PORT: "\${CLOAK_DEBUG_PORT}"
      PLATFORM_EMAIL: "\${PLATFORM_EMAIL}"
      PLATFORM_PASSWORD: "\${PLATFORM_PASSWORD}"
YAMLEOF

ok "~/.hermes/config.yaml tertulis"

# ─── 4. Buat Hermes Cron Jobs ─────────────────────────────────────────────────
echo ""
echo "[4/4] Membuat cron jobs Hermes..."

PYTHON="$(cd "$(dirname "$0")/../venv" && pwd)/bin/python"
HERMES_CLI="$(cd "$(dirname "$0")/../venv" && pwd)/bin/hermes"

if [[ ! -f "$PYTHON" ]]; then
    warn "Python venv hermes-agent tidak ditemukan di: $PYTHON"
    warn "Jalankan dulu: cd hermes-agent && ./scripts/install.sh"
    warn "Cron jobs akan dibuat manual nanti."
else
    # Cron 1: Evaluasi earning setiap 30 menit
    "$PYTHON" "$HERMES_CLI" cron create "*/30 * * * *" \
      "Panggil get_earnings dari MCP money-agent. Jika needStrategySwitch=true, panggil evaluate_strategy lalu log_strategy_switch. Kirim ringkasan ke Telegram." \
      --name "HermesMoneyAgent: Evaluasi 30 Menit" \
      --deliver telegram \
      2>/dev/null && ok "Cron 1: Evaluasi earning setiap 30 menit ✅" || warn "Cron 1 gagal dibuat (mungkin sudah ada)"

    # Cron 2: Laporan harian pukul 22:00
    "$PYTHON" "$HERMES_CLI" cron create "0 22 * * *" \
      "Panggil get_earnings untuk laporan lengkap hari ini. Ringkas: total earned, platform terbaik, rata-rata $/jam. Kirim ke Telegram dengan format tabel." \
      --name "HermesMoneyAgent: Laporan Harian" \
      --deliver telegram \
      2>/dev/null && ok "Cron 2: Laporan harian 22:00 ✅" || warn "Cron 2 gagal dibuat"

    # Cron 3: Cek platform baru setiap hari Senin pagi
    "$PYTHON" "$HERMES_CLI" cron create "0 9 * * 1" \
      "Jalankan discover_tasks dari MCP money-agent. Cari platform baru dengan $/jam lebih tinggi dari platform aktif saat ini. Kirim rekomendasi ke Telegram." \
      --name "HermesMoneyAgent: Scan Platform Mingguan" \
      --deliver telegram \
      2>/dev/null && ok "Cron 3: Scan platform mingguan Senin 09:00 ✅" || warn "Cron 3 gagal dibuat"

    echo ""
    echo "Cron jobs yang aktif:"
    "$PYTHON" "$HERMES_CLI" cron list 2>/dev/null || warn "hermes cron list gagal"
fi

# ─── Selesai ─────────────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════"
echo "  SETUP SELESAI!"
echo "══════════════════════════════════════════════════════"
echo ""
echo "Yang sudah dikonfigurasi:"
echo "  ✅ Telegram Gateway (bot menerima & mengirim pesan)"
echo "  ✅ busy_input_mode: steer (pesan masuk saat Hermes bekerja)"
echo "  ✅ Cron: Evaluasi 30 menit, laporan harian, scan platform mingguan"
echo "  ✅ MCP server: money-agent tools terdaftar"
echo ""
echo "Cara menjalankan agent:"
echo "  node src/start.js"
echo ""
echo "Perintah Telegram yang bisa dikirim ke bot:"
echo "  'toloka ok'    — Toloka sudah login, mulai kerja"
echo "  'da ok'        — DataAnnotation.tech siap"
echo "  'outlier ok'   — Outlier AI siap"
echo "  'status'       — Laporan earning saat ini (via Hermes langsung)"
echo "  'pause'        — Jeda (via busy_input_mode steer)"
echo "  'resume'       — Lanjut"
echo "  'ganti ke Textbroker' — Pindah platform"
echo ""
echo "⚠  Telegram Bot Token: ${TELEGRAM_BOT_TOKEN:0:10}..."
echo "⚠  Chat ID: $TELEGRAM_CHAT_ID"
echo ""
