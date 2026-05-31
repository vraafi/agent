import os
import time
from dotenv import load_dotenv

load_dotenv()

from browser_agent import BrowserAgent
from api_client import GeminiClient

def run_survey_auto():
    print("="*60)
    print("🚀 MEMULAI OTOMATISASI PENUH SURVEI (CLOAK BROWSER)")
    print("="*60)

    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
    llm = GeminiClient(api_keys) if api_keys else None

    opini = "Menurut saya, pekerja kantoran terhebat adalah mereka yang memiliki filosofi 'Menjadi Solusi, Bukan Beban'. Mereka mampu mengatasi masalah secara mandiri tanpa menciptakan drama, memiliki integritas tinggi, dan rasa kepemilikan yang kuat."
    skill = "Kombinasi antara hard skills seperti analisis data dan penguasaan teknologi, dengan soft skills seperti critical thinking, komunikasi empatik, adaptabilitas, dan manajemen waktu yang berfokus pada skala prioritas (Eisenhower Matrix)."

    task_instruction = (
        "Anda sudah berada di https://member.metroopinion.com/dashboard (atau navigasi ke sana jika belum). "
        "Tugas Anda: 1. Klik tombol 'Mulai survei'. "
        "2. Selesaikan seluruh form survei secara logis. "
        "Jika ada pertanyaan esai/teks tentang opini pekerja kantoran, isikan teks berikut: " + opini + " "
        "Jika ada pertanyaan tentang skill, isikan teks berikut: " + skill + " "
        "Selesaikan survei hingga halaman konfirmasi/akhir survei tercapai."
    )

    try:
        agent = BrowserAgent(headless=False, use_camoufox=False, llm_client=llm)
        print("\n[Menginisiasi Komputasi AI untuk Browser-Use...]")
        result = agent.execute_task(task_instruction, max_steps=20)
        print("\n[Hasil Eksekusi Agent]:", result)
    except Exception as e:
        print(f"\n❌ Terjadi kesalahan: {e}")

if __name__ == "__main__":
    run_survey_auto()
