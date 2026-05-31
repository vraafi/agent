import os
import time
from dotenv import load_dotenv

# Load env untuk mengambil API keys
load_dotenv()

from browser_agent import BrowserAgent
from api_client import GeminiClient

def run_cloak_session():
    print("="*60)
    print("🚀 ANTIGRAVITY CLOAK BROWSER SESSION (METROOPINION)")
    print("="*60)

    # Inisialisasi LLM untuk fitur Vision Fallback jika klik standar gagal
    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
    llm = GeminiClient(api_keys) if api_keys else None

    # Data survei yang sudah kita riset
    survey_data = {
        "opini": "Menurut saya, pekerja kantoran terhebat adalah mereka yang memiliki filosofi 'Menjadi Solusi, Bukan Beban'. Mereka mampu mengatasi masalah secara mandiri tanpa menciptakan drama, memiliki integritas tinggi, dan rasa kepemilikan yang kuat.",
        "skill": "Kombinasi antara hard skills seperti analisis data dan penguasaan teknologi, dengan soft skills seperti critical thinking, komunikasi empatik, adaptabilitas, dan manajemen waktu yang berfokus pada skala prioritas (Eisenhower Matrix)."
    }

    # Menggunakan CDP (Terhubung ke browser Brave/Chrome Anda yang sudah terbuka dan sudah login)
    print("\n[Menghubungkan ke Browser Anda yang sudah terbuka...]")
    try:
        with BrowserAgent(headless=False, use_camoufox=False, llm_client=llm) as browser:
            print("\n[1] Berhasil terhubung ke browser Anda!")
            
            print("\n[2] Menavigasi ke Dashboard MetroOpinion...")
            print("\n[2] Menavigasi ke Dashboard MetroOpinion...")
            browser.navigate("https://member.metroopinion.com/dashboard")
            time.sleep(3)
            
            print("\n[3] Mencari dan mengeklik tombol 'Mulai survei'...")
            clicked = False
            
            # Coba menggunakan pencarian teks biasa
            try:
                # Menggunakan human_click agar pergerakan mouse tidak terdeteksi bot
                browser.human_click("text=Mulai survei")
                print("✅ Berhasil mengeklik tombol 'Mulai survei' via selector teks!")
                clicked = True
            except Exception as e:
                print(f"⚠️ Klik teks standar gagal. Mencoba metode lain...")

            # Jika gagal, coba gunakan Vision AI Fallback (Gemini Vision menganalisis screenshot halaman)
            if not clicked and llm:
                print("\n[Visual AI] Mencoba mendeteksi posisi tombol secara visual...")
                fallback_success = browser.visual_action_fallback(
                    target_description="Tombol besar atau link dengan tulisan 'Mulai survei'", 
                    action_type="click"
                )
                if fallback_success:
                     print("✅ Berhasil mengeklik menggunakan panduan Visual AI!")
                     clicked = True

            if clicked:
                print("\n" + "="*50)
                print("📝 BERHASIL MASUK KE SURVEI")
                print("="*50)
                print("Gunakan data berikut jika ada pertanyaan essay/terbuka:\n")
                print(f"OPINI:\n{survey_data['opini']}\n")
                print(f"SKILL:\n{survey_data['skill']}\n")
                
                print("Karena form survei bisa sangat dinamis (menggunakan Iframe dinamis pihak ketiga),")
                print("saya akan membiarkan jendela browser tetap terbuka agar Anda bisa menyelesaikan/memantaunya.")
                input("\n>>> TEKAN [ENTER] UNTUK MENUTUP BROWSER JIKA SURVEI SELESAI <<<")
            else:
                print("\n❌ Gagal menemukan tombol. Anti-bot kemungkinan telah menyembunyikan elemen atau memblokir akses.")
                input("Tekan ENTER untuk menutup browser...")
                
    except Exception as e:
        print(f"\n❌ Terjadi kesalahan sistem: {e}")

if __name__ == "__main__":
    run_cloak_session()
