"""
llm_config.py — Konfigurasi model LLM untuk Nexus DualBrain AI
Update: Model roles diperbaiki (Mei 2026)
Fix: Tambah supports_google_search flag untuk mencegah 500 error pada model Gemma

Hierarki Model (urutan prioritas):
  1. Primary  — gemma-4-31b-it         (1500 RPD, terkuat, default utama)
  2. Secondary — gemma-4-26b-a4b-it    (fallback pertama jika 31b gagal)
  3. Last Resort — gemini-3.1-flash-lite-preview  (20 RPD, hanya darurat)
"""

LLM_MODELS = {
    # Primary: mapped to gemma-4-31b-it
    "gemma-4-31b-it": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent",
        "max_retries": 3,
        "timeout": 45,
        "rate_limit_delay": 10,
        "supports_thinking": False,
        "supports_google_search": True,
    },

    # Secondary: mapped to gemma-4-26b-a4b-it
    "gemma-4-26b-a4b-it": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent",
        "max_retries": 3,
        "timeout": 45,
        "rate_limit_delay": 10,
        "supports_thinking": False,
        "supports_google_search": True,
    },

    # Last Resort: mapped to gemini-3.1-flash-lite-preview
    "gemini-3.1-flash-lite-preview": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent",
        "max_retries": 3,
        "timeout": 45,
        "rate_limit_delay": 10,
        "supports_thinking": False,
        "supports_google_search": True,
    },
}

# Role Assignment

# Default: gemini-3.1-flash-lite-preview (1.5M RPD) — dipakai untuk semua task biasa
DEFAULT_LLM_MODEL = "gemini-3.1-flash-lite-preview"

# Codegen: model terkuat untuk generate kode Python production-ready
CODEGEN_MODEL = "gemma-4-31b-it"

# Negotiation: model menengah untuk reply klien, filter job, reasoning moderat
NEGOTIATION_MODEL = "gemma-4-26b-a4b-it"

# Fallback chain: 31b gagal -> 26b -> flash-lite (last resort, hemat quota)
FALLBACK_MODEL = "gemini-3.1-flash-lite-preview"
