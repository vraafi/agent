import os
import sys
import time
import logging
import signal
import threading
from logging.handlers import RotatingFileHandler
from dotenv import load_dotenv

original_signal = signal.signal
def patched_signal(signum, handler):
    if threading.current_thread() is threading.main_thread():
        return original_signal(signum, handler)
    return None
signal.signal = patched_signal

from api_client import GeminiClient
from browser_agent import BrowserAgent
from freelance_orchestrator import FreelanceOrchestrator
from hermes_agent import HermesAgent
from linkedin_agent import LinkedinAgent

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
    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
    if not api_keys:
        api_keys = [os.environ.get("GEMINI_API_KEY")]
    llm = GeminiClient(api_keys)
    return llm

if __name__ == "__main__":
    logging.info("Memulai Nexus DualBrain AI - Fastwork Only Mission")
    import subprocess
    
    # 1. Menghidupkan 9router (LLM Server) secara otomatis
    logging.info("Memastikan peladen 9router aktif di latar belakang (Port 20128)...")
    try:
        subprocess.Popen(
            'cmd.exe /c "set PORT=20128 && node C:\\Users\\user\\AppData\\Roaming\\npm\\node_modules\\9router\\app\\server.js"',
            shell=True,
            creationflags=subprocess.CREATE_NEW_CONSOLE
        )
        time.sleep(3) # Tunggu router bernapas
    except Exception as e:
        logging.error(f"Gagal memicu 9router: {e}")
        
    # 2. Menghidupkan CloakBrowser secara otomatis
    from browser_agent import _resolve_brave_path, _auto_launch_brave, _find_active_cdp_url
    logging.info("Memastikan CloakBrowser terbuka di awal...")
    cdp_url = _find_active_cdp_url(port=9222)
    if not cdp_url:
        logging.warning("CloakBrowser belum terbuka. Menghidupkan sekarang...")
        path = _resolve_brave_path()
        if path:
            _auto_launch_brave(path, port=9222)
            time.sleep(2)
        else:
            logging.error("Gagal menemukan path eksekusi CloakBrowser/Brave.")

    llm = build_shared_resources()
    
    # Central browser for Hermes & other agents
    temp_browser = BrowserAgent(llm_client=llm)
    
    # Initialise Hermes Agent (if API key provided)
    hermes = HermesAgent(gemini_client=llm)
    # Simple status callback used by Hermes /status
    def status_cb():
        return {"current_step": "idle", "task_id": "N/A", "uptime": "unknown"}
    # Simple finance callback used by Hermes /income etc.
    def finance_cb():
        return {"completed_jobs": 0, "total_revenue": 0.0, "pending_revenue": 0.0, "total_proposals": 0}
    hermes.start_command_listener(status_callback=status_cb, finance_callback=finance_cb)
    
    # Inisialisasi LinkedIn agent (LIVE MODE)
    linkedin = LinkedinAgent(browser_agent=temp_browser, llm_client=llm, hermes_agent=hermes, dry_run=False)
    
    # Inisialisasi SproutGigs agent (Micro-task automation)
    from sproutgigs_agent import SproutGigsAgent
    sproutgigs = SproutGigsAgent(browser_agent=temp_browser, dry_run=False)
    sprout_thread = threading.Thread(target=sproutgigs.run_worker_loop, name="SproutGigsWorker", daemon=True)
    sprout_thread.start()
    
    # Start log monitor in background
    from log_monitor import LogMonitor
    log_monitor = LogMonitor(log_path="agent_activity.log", interval_seconds=30)
    log_monitor.start()

    # Start the freelance orchestrator as before (Fastwork only)
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
        log_monitor.stop()
        try:
            temp_browser.quit()
        except Exception:
            pass
        # Gracefully stop Hermes listener
        hermes.stop_command_listener()
