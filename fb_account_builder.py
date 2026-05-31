import logging
import time
import os
from dotenv import load_dotenv

from api_client import GeminiClient
from browser_agent import BrowserAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("FB_Builder")

def build_shared_resources():
    load_dotenv()
    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11)
                if os.environ.get(f"GEMINI_KEY_{i}")]
    if not api_keys:
        api_keys = [os.environ.get("GEMINI_API_KEY")]
    
    return GeminiClient(api_keys)

def update_bio(browser: BrowserAgent):
    logger.info("Mulai mengubah Bio Profil Facebook...")
    bio_text = "Evan Fisher | F&B Consultant | Membantu UMKM Kuliner menaikkan omzet lewat strategi marketing & copywriting mematikan."
    
    result = browser.execute_task(
        f"Buka https://www.facebook.com/me/. "
        f"Cari tombol 'Edit bio' atau 'Edit profil'. "
        f"Ubah teks bio menjadi persis seperti ini: '{bio_text}' "
        f"Simpan perubahan. Jika sudah selesai atau bio sudah benar, gunakan aksi 'done' dengan result 'BIO_UPDATED'.",
        max_steps=10
    )
    logger.info(f"Status Update Bio: {result}")

def join_groups(browser: BrowserAgent):
    keywords = ["UMKM Kuliner", "Pengusaha Makanan", "Bisnis F&B", "Jajanan Pasar", "Grup Kuliner Nusantara"]
    logger.info("Mulai mencari dan bergabung ke Grup Kuliner...")
    
    for kw in keywords[:3]: # Target join 3 grup per sesi agar aman
        logger.info(f"Mencari grup dengan kata kunci: {kw}")
        
        # Navigate to FB Search for groups
        result = browser.execute_task(
            f"Buka https://www.facebook.com/search/groups/?q={kw.replace(' ', '%20')}. "
            f"Lihat hasil pencarian. Cari tombol 'Join' atau 'Gabung' pada grup yang relevan dengan makanan/bisnis. "
            f"Klik tombol Join tersebut (maksimal 1-2 grup saja di halaman ini). "
            f"Jika ada pertanyaan kuesioner dari admin grup, jawab dengan sopan seperti 'Ingin belajar dan berbagi tips bisnis makanan'. "
            f"Setelah berhasil join atau mengajukan permintaan gabung, gunakan aksi 'done' dengan result 'GROUP_JOINED'.",
            max_steps=15
        )
        logger.info(f"Status Join Grup '{kw}': {result}")
        time.sleep(15) # Jeda antar pencarian

def warmup_feed(browser: BrowserAgent):
    logger.info("Mulai melatih algoritma Beranda FB (Warm-Up)...")
    
    result = browser.execute_task(
        "Buka https://www.facebook.com/. "
        "Gulir (scroll) ke bawah perlahan. Jika kamu melihat postingan yang berkaitan dengan Makanan, Minuman, atau Bisnis, klik tombol 'Like' atau 'Suka'. "
        "Lakukan scroll dan like ini sebanyak 3-5 kali secara acak untuk melatih algoritma. "
        "Jika sudah melakukan 3 kali like, gunakan aksi 'done' dengan result 'WARMUP_FINISHED'.",
        max_steps=20
    )
    logger.info(f"Status Warm-Up: {result}")

def main():
    print("==================================================")
    print("FB ACCOUNT BUILDER : WARM-UP & PERSONA SETUP")
    print("==================================================\n")
    
    llm = build_shared_resources()
    
    print("[INIT] Mempersiapkan Agen UI Browser...")
    browser = BrowserAgent(llm_client=llm)
    
    print("PENTING: Pastikan Anda sudah login akun Facebook di Cloak Browser sebelum menjalankan ini.\n")
    
    try:
        # 1. Update Bio Profile
        update_bio(browser)
        time.sleep(10)
        
        # 2. Cari dan Join Grup
        join_groups(browser)
        time.sleep(10)
        
        # 3. Latih Algoritma Feed
        warmup_feed(browser)
        
        print("\n[SELESAI] Setup dan Pemanasan Akun Facebook berhasil dilakukan!")
        print("Algoritma Beranda Anda kini akan lebih memprioritaskan target-target UMKM Kuliner.")
            
    except KeyboardInterrupt:
        print("\nFB Account Builder dihentikan oleh user.")
    finally:
        try:
            browser.quit()
        except:
            pass

if __name__ == "__main__":
    main()
