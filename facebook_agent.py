import logging
import time
import json
import os
import random
from browser_agent import BrowserAgent
from identity_manager import IdentityManager

class FacebookAgent:
    def __init__(self, browser_agent: BrowserAgent, llm_client):
        self.browser = browser_agent
        self.llm = llm_client
        self.identity = IdentityManager()
        self.logger = logging.getLogger(__name__)
        
    def _is_logged_in(self) -> bool:
        result = self.browser.execute_task(
            "Buka https://www.facebook.com/ lalu periksa apakah kamu sudah login. "
            "Tanda login biasanya ada feed utama dan ikon profil, sedangkan belum login biasanya muncul halaman form login/daftar. "
            "Gunakan aksi 'done' dengan result 'LOGGED_IN' jika terlihat feed, atau 'NOT_LOGGED_IN' jika tidak.",
            max_steps=5
        )
        return "LOGGED_IN" in result or "Finished" in result

    def search_groups(self) -> int:
        self.logger.info("Memulai misi ekspansi Facebook Group UMKM.")
        applied = 0
        
        if not self._is_logged_in():
            self.logger.error("Facebook belum login. Agen Facebook dihentikan sementara. Harap login manual di Cloak Browser.")
            return 0
            
        # Target spesifik grup UMKM
        group_url = "https://www.facebook.com/groups/feed/" 
        
        self.logger.info(f"Mengakses Grup Facebook Target...")
        
        # PENTING: Karena ini adalah MVP (Minimum Viable Product) rancangan awal, 
        # kita hanya akan melakukan penjelajahan ringan dan pembacaan feed.
        # Interaksi langsung (commenting) membutuhkan scraping HTML dinamis yang sangat rumit di FB.
        
        result = self.browser.execute_task(
            f"Buka {group_url} secara langsung. "
            "Cari postingan dari anggota grup yang membicarakan jualan makanan mereka sepi atau menanyakan tips jualan (kata kunci: jualan, sepi, tips, masukan). "
            "Jika ketemu sebuah postingan keluhan F&B, salin teks curhatan mereka. "
            "Gunakan aksi 'done' dengan result JSON: {'author': 'Nama', 'post_content': 'Teks keluhan...'} "
            "Jika tidak ketemu, gunakan aksi 'done' dengan result 'NO_TARGET_FOUND'.",
            max_steps=15
        )
        
        if isinstance(result, str) and ("NO_TARGET_FOUND" in result):
            self.logger.info(f"Tidak ada target UMKM yang butuh bantuan di Grup saat ini.")
            time.sleep(10)
            return applied
            
        try:
            data = {}
            if isinstance(result, dict):
                data = result
            elif isinstance(result, str):
                start = result.find('{')
                end = result.rfind('}') + 1
                if start >= 0 and end > start:
                    data = json.loads(result[start:end])
            
            if data and data.get("post_content"):
                author = data.get("author", "Bapak/Ibu")
                content = data.get("post_content", "")
                
                self.logger.info(f"Target FB Ditemukan! Author: {author}")
                
                # Generate Solusi ala Evan Fisher via LLM
                reply_text = self._generate_fb_reply(author, content)
                self.logger.info(f"Draft Komentar Disiapkan:\n{reply_text}")
                
                # Auto-comment the draft to the post
                self.logger.info("Mengeksekusi pengiriman komentar otomatis ke Facebook...")
                comment_result = self.browser.execute_task(
                    f"Ini adalah postingan yang tadi kita analisa. Tugasmu sekarang adalah memposting komentar ini:\n\n{reply_text}\n\n"
                    "Cari kolom komentar (Write a comment / Tulis komentar), klik, ketikkan teks tersebut, lalu tekan Enter atau klik tombol kirim. "
                    "Setelah selesai, gunakan aksi 'done' dengan result 'COMMENT_SENT'.",
                    max_steps=5
                )
                self.logger.info(f"Status Pengiriman Komentar: {comment_result}")
                
                applied += 1
                
        except Exception as e:
            self.logger.error(f"Gagal memproses target FB: {e}")
            
        return applied

    def _generate_fb_reply(self, author: str, post_content: str) -> str:
        self.logger.info("Men-generate balasan empati + solusi via LLM...")
        prompt = (
            f"Kamu adalah Evan Fisher, konsultan bisnis. "
            f"Di grup komunitas Facebook, {author} baru saja curhat/memposting tentang bisnis makanannya: \"{post_content}\"\n\n"
            f"TUGAS:\n"
            f"Buatkan draft komentar Facebook (maksimal 3 paragraf). Berikan empati singkat, lalu tunjukkan 1 kesalahan fatal dari promosi/mindset mereka berdasarkan curhatannya, dan berikan 1 solusi copywriting/strategi jitu secara blak-blakan. "
            f"Akhiri dengan menawarkan DM untuk ngobrol lebih lanjut."
        )
        try:
            response = self.llm.generate_content(prompt)
            if response: return response
            return "Halo pak, saya lihat masalah utamanya di copywriting. Coba DM saya, kita bedah promosinya gratis."
        except Exception as e:
            return "Cek DM ya Pak, saya punya strategi jitu untuk jualan bapak."
