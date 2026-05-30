"""
main.py — Nexus DualBrain AI
==============================
Satu perintah untuk menjalankan misi Fastwork (10 dolar dalam 8 jam).

  python3 main.py

"""

import time
import logging
from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv

from api_client import GeminiClient
from browser_agent import BrowserAgent
from freelance_orchestrator import FreelanceOrchestrator

load_dotenv()

# ─── LOGGING ───
log_formatter = logging.Formatter("%(asctime)s [%(threadName)s] %(levelname)s — %(message)s")
file_handler = RotatingFileHandler("agent_activity.log", maxBytes=5*1024*1024, backupCount=2)
file_handler.setFormatter(log_formatter)
console_handler = logging.StreamHandler()
console_handler.setFormatter(log_formatter)
logging.basicConfig(level=logging.INFO, handlers=[file_handler, console_handler])

def build_shared_resources():
    import os
    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11)
                if os.environ.get(f"GEMINI_KEY_{i}")]
    if not api_keys:
        api_keys = [os.environ.get("GEMINI_API_KEY")]
    
    llm = GeminiClient(api_keys)
    return llm

if __name__ == "__main__":
    logging.info("Memulai Nexus DualBrain AI - Fastwork Only Mission")
    llm = build_shared_resources()
    
    # Kita hanya menggunakan satu browser terpusat untuk Orchestrator
    # Note: Orchestrator akan membungkus agen Fastwork dengan browser terpisah
    temp_browser = BrowserAgent(llm_client=llm)
    
    orchestrator = FreelanceOrchestrator(
        browser_agent=temp_browser,
        llm_client=llm,
        branding_strategies={}
    )
    
    try:
        orchestrator.start()
    except KeyboardInterrupt:
        logging.info("Dihentikan oleh user.")
    finally:
        try:
            temp_browser.quit()
        except:
            pass
