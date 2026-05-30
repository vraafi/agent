"""
linkedin_agent.py — Nexus DualBrain AI
=========================================
Agen LinkedIn: navigasi ke linkedin.com, cari lowongan (python, scraping, data),
"""

import logging
import time
import json
import re
from browser_agent import BrowserAgent
from identity_manager import IdentityManager

class LinkedinAgent:
    def __init__(self, browser_agent: BrowserAgent, llm_client, hermes_agent=None):
        self.browser = browser_agent
        self.llm = llm_client
        self.identity = IdentityManager()
        self.hermes = hermes_agent
        self.logger = logging.getLogger(__name__)

    def _is_logged_in(self) -> bool:
        result = self.browser.execute_task(
            "Buka https://www.linkedin.com/feed/ lalu periksa apakah kamu sudah login. "
            "Tanda login biasanya ada avatar, nama profil, atau feed postingan. "
            "Gunakan aksi 'done' dengan result 'LOGGED_IN' jika terlihat, atau 'NOT_LOGGED_IN' jika tidak.",
            max_steps=3
        )
        return "LOGGED_IN" in result or "Finished" in result

    def login_linkedin(self) -> bool:
        self.logger.info("Memulai sekuens login LinkedIn...")
        
        if self._is_logged_in():
            self.logger.info("LinkedIn sudah terdeteksi login.")
            return True

        self.logger.warning(
            "Login LinkedIn memerlukan intervensi manual (sesuai aturan user). "
            "Meminta bantuan via Telegram."
        )
        self.browser.request_human_help(
            reason="Tolong bantu login di website ini. Balas 'sudah' jika sudah selesai.",
            max_wait=1800,
            hermes_agent=self.hermes,
        )
        
        if self._is_logged_in():
            self.logger.info("LinkedIn login berhasil setelah intervensi manual.")
            return True
            
        self.logger.error("LinkedIn login gagal / belum dilakukan user.")
        return False

    def search_and_execute_missions(self) -> int:
        """
        Misi pencarian kerja LinkedIn:
        """
        self.logger.info("Memulai misi pencarian job di LinkedIn.")
        applied_or_completed = 0
        
        # Langkah 1: Coba cari job di LinkedIn
        self.logger.info("Mencari job di LinkedIn...")
        result = self.browser.execute_task(
            "Buka https://www.linkedin.com/jobs/search/?keywords=Python%20Scraping%20Automation&f_WT=2&sortBy=DD (LinkedIn Jobs Remote Terbaru) secara langsung. "
            "Lakukan pencarian atau filter proyek dengan kata kunci 'python' atau 'scraping'. "
            "Cari lowongan pekerjaan yang menggunakan 'Easy Apply' jika memungkinkan, lalu masuk ke halamannya dan klik tombol apply. "
            "Jika tidak ada lowongan proyek yang cocok atau tidak bisa melamar, gunakan aksi 'done' dengan result 'NO_DIRECT_JOBS_FOUND'. "
            "Jika berhasil melamar, gunakan aksi 'done' dengan result 'JOB_APPLIED'.",
            max_steps=15
        )
        
        if "JOB_APPLIED" in result:
            self.logger.info("Berhasil melamar pekerjaan di LinkedIn!")
            applied_or_completed += 1
            return applied_or_completed
            
        self.logger.info("Tidak ada proyek langsung ditemukan di LinkedIn saat ini. Melakukan cooldown sebelum pencarian berkala berikutnya...")
        time.sleep(60)
        return applied_or_completed

    def check_notifications(self) -> None:
        self.logger.info("Memeriksa notifikasi LinkedIn...")
        self.browser.execute_task(
            "Buka https://www.linkedin.com/notifications/ secara langsung. "
            "Baca sekilas daftar notifikasi yang ada di halaman. "
            "PENTING: Jangan mengeklik notifikasi apapun secara individual karena akan menyebabkan looping! Cukup kunjungi halamannya agar sistem LinkedIn menandainya sebagai telah dibaca. "
            "Langsung gunakan aksi 'done' dengan result 'NOTIFICATIONS_CHECKED' setelah halaman terbuka dan berhasil dimuat.",
            max_steps=3
        )

    def post_content(self) -> None:
        self.logger.info("Memposting pitch deck B2B Evan Fisher style ke LinkedIn...")
        pitch = (
            "$5B+ raised Series A to IPO | I help tech founders raise their next big round. \\n\\n"
            "If your AI/SaaS startup is struggling to close funding, your pitch is likely too generic.\\n"
            "We build data pipelines and AI systems that directly accelerate business growth and cut operational costs.\\n"
            "Stop the 'Investment Banker Special' dry pitches. Let's make your VC narrative undeniably precise.\\n\\n"
            "#TechFounders #VCFunding #AI #DataPipelines #Startups"
        )
        self.browser.execute_task(
            f"Buka https://www.linkedin.com/feed/ secara langsung. "
            f"Jika modal posting belum terbuka, cari dan klik tombol 'Mulai buat posting' atau 'Start a post'. "
            f"Setelah modal terbuka (atau jika sudah terbuka), KAMU TIDAK PERLU MENCARI KOTAK TEKS! Kursor sudah otomatis aktif di sana. "
            f"Langsung gunakan aksi 'type' dengan parameter `index: -1` (minus satu) untuk menulis tanpa mencari tombol! "
            f"Ketik teks berikut ini:\\n\\n{pitch}\\n\\n"
            f"Setelah teks terisi, klik tombol 'Post' atau 'Posting'. "
            f"Jika sudah selesai memposting, gunakan aksi 'done' dengan result 'POST_SUCCESS'.",
            max_steps=8
        )
