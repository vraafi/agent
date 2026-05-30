"""
fastwork_agent.py — Nexus DualBrain AI
=========================================
Agen Fastwork: navigasi ke fastwork.id, cari pekerjaan (python, scraping, data), 
atau secara otonom mencari cara lain mendapatkan $10 dalam 8 jam jika buntu.
"""

import logging
import time
import json
import re
from browser_agent import BrowserAgent
from identity_manager import IdentityManager

class FastworkAgent:
    def __init__(self, browser_agent: BrowserAgent, llm_client, hermes_agent=None):
        self.browser = browser_agent
        self.llm = llm_client
        self.identity = IdentityManager()
        self.hermes = hermes_agent
        self.logger = logging.getLogger(__name__)

    def _is_logged_in(self) -> bool:
        result = self.browser.execute_task(
            "Buka https://fastwork.id lalu periksa apakah kamu sudah login. "
            "Tanda login biasanya ada avatar, nama profil, atau menu chat. "
            "Gunakan aksi 'done' dengan result 'LOGGED_IN' jika terlihat, atau 'NOT_LOGGED_IN' jika tidak.",
            max_steps=3
        )
        return "LOGGED_IN" in result or "Finished" in result

    def login_fastwork(self) -> bool:
        self.logger.info("Memulai sekuens login Fastwork...")
        
        # Fastwork login manual sesuai instruksi (modal $0, intervensi Telegram)
        if self._is_logged_in():
            self.logger.info("Fastwork sudah terdeteksi login.")
            return True

        self.logger.warning(
            "Login Fastwork memerlukan intervensi manual (sesuai aturan user). "
            "Meminta bantuan via Telegram."
        )
        self.browser.request_human_help(
            reason="Tolong bantu login di website ini. Balas 'sudah' jika sudah selesai.",
            max_wait=1800,
            hermes_agent=self.hermes,
        )
        
        if self._is_logged_in():
            self.logger.info("Fastwork login berhasil setelah intervensi manual.")
            return True
            
        self.logger.error("Fastwork login gagal / belum dilakukan user.")
        return False

    def search_and_execute_missions(self) -> int:
        """
        Misi 8 jam hasilkan $10:
        Pertama coba mencari proyek di Fastwork Jobboard. Jika kosong, 
        lakukan cooldown dan cari lagi secara berkala.
        """
        self.logger.info("Memulai misi continuous execution: $10 dalam 8 jam.")
        applied_or_completed = 0
        
        # Langkah 1: Coba cari job di Fastwork
        self.logger.info("Mencari job di Fastwork...")
        result = self.browser.execute_task(
            "Buka halaman utama pencarian pekerjaan Fastwork. "
            "JANGAN membatasi diri dengan kata kunci 'python' atau 'scraping'. Telusuri SEMUA pekerjaan terbaru di kategori IT/Pemrograman (seperti web, bot, data, script, bug fix). "
            "PENTING: Jika tidak ada tombol yang valid di daftar elemen (Interactive Elements), cobalah mengeklik link/judul pekerjaan apa saja yang berhubungan dengan IT yang terdeteksi di ringkasan halaman. "
            "Jika ada proyek yang menarik dan bisa diklik, klik proyek tersebut. "
            "PENTING: JANGAN mengeklik pekerjaan yang sama lebih dari 2 kali berturut-turut. Jika kamu sudah mengeklik namun halaman tidak berpindah, segera hentikan klik dan gunakan aksi 'done' dengan result 'JOB_CLICKED'. "
            "PENTING: Jangan melakukan aksi scroll berulang-ulang lebih dari 2 kali. Jika pekerjaan tidak bisa diklik atau tidak ada di elemen interaktif, langsung gunakan aksi 'done' dengan result 'NO_DIRECT_JOBS_FOUND'. "
            "Jika berhasil masuk ke halaman pekerjaan dan melamar, gunakan aksi 'done' dengan result 'JOB_APPLIED'.",
            max_steps=15
        )
        
        if "JOB_APPLIED" in result:
            self.logger.info("Berhasil melamar pekerjaan di Fastwork!")
            applied_or_completed += 1
            return applied_or_completed
            
        # Langkah 2: Cooldown dan retry untuk menjaga stabilitas platform Fastwork
        self.logger.info("Tidak ada proyek langsung ditemukan di Fastwork saat ini. Melakukan cooldown sebelum pencarian berkala berikutnya...")
        time.sleep(60)
        return applied_or_completed

