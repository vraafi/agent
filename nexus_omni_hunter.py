import logging
import time
import os
from dotenv import load_dotenv

from api_client import GeminiClient
from browser_agent import BrowserAgent
from instagram_agent import InstagramAgent
from facebook_agent import FacebookAgent
from marketplace_agent import MarketplaceAgent

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def build_shared_resources():
    load_dotenv()
    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11)
                if os.environ.get(f"GEMINI_KEY_{i}")]
    if not api_keys:
        api_keys = [os.environ.get("GEMINI_API_KEY")]
    
    llm = GeminiClient(api_keys)
    return llm

def main():
    print("==================================================")
    print("NEXUS OMNI HUNTER : MULTI-PLATFORM OUTREACH")
    print("==================================================\n")
    
    llm = build_shared_resources()
    
    # Semua agen menggunakan UI Browser (Cloak Browser) untuk menghindari deteksi anti-bot
    print("[INIT] Mempersiapkan Agen UI Browser (Instagram, Facebook & Tokopedia)...")
    ui_browser = BrowserAgent(llm_client=llm)
    
    ig_agent = InstagramAgent(browser_agent=ui_browser, llm_client=llm)
    

    fb_agent = FacebookAgent(browser_agent=ui_browser, llm_client=llm)
    mp_agent = MarketplaceAgent(browser_agent=ui_browser, llm_client=llm)
    
    print("\nSemua Agen Siap Diterjunkan!")
    print("PENTING: Pastikan Anda sudah login akun Instagram, Facebook, dan Tokopedia di dalam Cloak Browser secara manual sebelum menjalankan siklus panjang ini.\n")
    
    try:
        target_dms = 30
        print(f"\n[OVERRIDE] Fokus penuh pada Instagram untuk mencapai {target_dms} DM sekarang juga.")
        
        for i in range(1, target_dms + 1):
            # --- SIKLUS INSTAGRAM ---
            print("\n" + "="*40)
            print(f"FASE 1: INSTAGRAM OUTREACH (Target: {i}/{target_dms})")
            print("="*40)
            # Cari 1 target dan generate draft portfolio
            ig_agent.search_and_execute_missions()
                
            print(f"\nJeda 60 detik sebelum melanjutkan ke target {i+1} untuk menghindari shadowban...")
            time.sleep(60) # Beri jeda agak lama antar DM di satu platform
            
        print("\n[SELESAI] Misi fokus 30 DM Instagram berhasil dirampungkan!")
            
    except KeyboardInterrupt:
        print("\nNexus Omni Hunter dihentikan oleh user.")
    finally:
        try:
            ui_browser.quit()
        except:
            pass

if __name__ == "__main__":
    main()
