"""
freelance_orchestrator.py
=========================
Koordinator utama yang SEPENUHNYA mendedikasikan diri untuk Fastwork.
Semua integrasi Upwork, Fiverr, dan Hyrve telah dicabut (Amputasi Total).

Logika:
  - Beroperasi penuh 24/7 di Fastwork.
  - Membawa misi "Continuous Execution: $10 dalam 8 jam".
"""

import time
import logging
import threading
import os
from datetime import datetime, timezone, timedelta

from email_monitor import EmailMonitor
from communication_hub import CommunicationHub
from fastwork_agent import FastworkAgent
from linkedin_agent import LinkedinAgent
from x_agent import XAgent
from financial_tracker import FinancialTracker
from circuit_breaker import CircuitBreaker
from error_learning import ErrorLearningSystem
from client_memory import ClientMemory
from browser_agent import BrowserAgent

logger = logging.getLogger(__name__)

WIB = timezone(timedelta(hours=7))
EMAIL_POLL_INTERVAL = int(os.environ.get("EMAIL_CHECK_INTERVAL", 300))

class FreelanceOrchestrator:

    def __init__(self, browser_agent, llm_client, branding_strategies: dict):
        self.browser = browser_agent
        self.llm = llm_client
        self.branding = branding_strategies
        self.finance = FinancialTracker()
        self.memory = ClientMemory()
        self.comm_hub = CommunicationHub()

        self.email_monitor = EmailMonitor()
        self._browser_lock = threading.Lock()

        # Circuit Breaker per platform
        self.circuit_breakers = {
            "fastwork": CircuitBreaker("fastwork"),
            "linkedin": CircuitBreaker("linkedin")
        }
        self.error_learner = ErrorLearningSystem()

    def start(self):
        self.email_monitor.start()
        logger.info("[Orchestrator] Freelance Agent aktif (Fastwork & LinkedIn - 24/7).")

        try:
            while True:
                # Terus-menerus menjalankan slot Fastwork dan LinkedIn
                for platform in ["fastwork", "linkedin"]:
                    job_data = self._run_platform_slot(platform)
                    if job_data:
                        return job_data
                
                logger.info("[Orchestrator] Istirahat sejenak sebelum memulai loop baru...")
                time.sleep(10)
        except KeyboardInterrupt:
            logger.info("[Orchestrator] Dihentikan oleh user.")
        finally:
            self.email_monitor.stop()

    def _login_platform(self, platform: str):
        try:
            with self._browser_lock:
                # Membuat thread browser independen untuk pengecekan login
                temp_browser = BrowserAgent(llm_client=self.llm)
                if platform == "fastwork":
                    agent = FastworkAgent(temp_browser, self.llm)
                    success = agent.login_fastwork()
                elif platform == "linkedin":
                    agent = LinkedinAgent(temp_browser, self.llm)
                    success = agent.login_linkedin()
                else:
                    success = False
                try:
                    temp_browser.quit()
                except Exception:
                    pass

            if success:
                logger.info("[Orchestrator] Login %s berhasil.", platform.upper())
            else:
                logger.warning("[Orchestrator] Login %s GAGAL — menunggu intervensi.", platform.upper())
        except Exception as exc:
            logger.warning("[Orchestrator] Error login %s: %s", platform, exc)

    def _run_platform_slot(self, platform: str):
        interrupt_event = threading.Event()
        logger.info("[Orchestrator] Platform aktif: %s", platform.upper())

        self._login_platform(platform)
        search_thread = self._start_search_thread(platform, interrupt_event)

        while search_thread.is_alive():
            time.sleep(EMAIL_POLL_INTERVAL)

            # Jika email prioritas ditangkap
            if self.email_monitor.has_priority_orders():
                logger.info("[Orchestrator] Menangani pesanan prioritas...")
                # Karena murni Fastwork, penanganan prioritas bisa disederhanakan
                pass

        interrupt_event.set()
        search_thread.join(timeout=30)
        return None

    def _start_search_thread(self, platform: str, interrupt_event: threading.Event) -> threading.Thread:
        t = threading.Thread(
            target=self._search_jobs,
            args=(platform, interrupt_event),
            daemon=True,
            name=f"Search-{platform}"
        )
        t.start()
        return t

    def _search_jobs(self, platform: str, stop: threading.Event):
        """Misi tanpa henti: 8 Jam untuk mendapatkan $10."""
        thread_browser = BrowserAgent(llm_client=self.llm)
        
        if platform == "fastwork":
            agent = FastworkAgent(thread_browser, self.llm)
        elif platform == "linkedin":
            agent = LinkedinAgent(thread_browser, self.llm)
        else:
            return
            
        logger.info("[Search-%s] Browser-Use thread browser siap. Memulai Misi 8 Jam.", platform)

        try:
            while not stop.is_set():
                try:
                    cb = self.circuit_breakers.get(platform)

                    def run_platform_logic():
                        # Laksanakan misi
                        agent.search_and_execute_missions()

                    try:
                        if cb:
                            cb.call(run_platform_logic)
                        else:
                            run_platform_logic()
                    except Exception as e:
                        logger.error("[Orchestrator] Error for %s: %s", platform, e)
                        time.sleep(60)

                    # Sedikit jeda setelah 1 putaran misi selesai, kemudian BERHENTI agar orchestrator lanjut ke platform lain
                    time.sleep(30)
                    break

                except Exception as exc:
                    logger.error("[Search-%s] Error utama: %s", platform, exc)
                    if not stop.is_set():
                        time.sleep(60)
                        break
        finally:
            try:
                thread_browser.quit()
            except Exception:
                pass

        logger.info("[Search-%s] Thread dihentikan.", platform.upper())
