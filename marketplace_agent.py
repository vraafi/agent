import logging
import time
import json
import random
from browser_agent import BrowserAgent
from identity_manager import IdentityManager

class MarketplaceAgent:
    def __init__(self, browser_agent: BrowserAgent, llm_client):
        self.browser = browser_agent
        self.llm = llm_client
        self.identity = IdentityManager()
        self.logger = logging.getLogger(__name__)

    def _is_logged_in(self, platform: str) -> bool:
        url = "https://www.tokopedia.com/" if platform == "tokopedia" else "https://shopee.co.id/"
        result = self.browser.execute_task(
            f"Buka {url} secara langsung lalu periksa apakah kamu sudah login. "
            "Tanda login biasanya ada profil atau ikon keranjang yang aktif, bukan tombol 'Masuk' atau 'Daftar'. "
            "Gunakan aksi 'done' dengan result 'LOGGED_IN' jika terlihat sudah login, atau 'NOT_LOGGED_IN' jika belum.",
            max_steps=5
        )
        return "LOGGED_IN" in result or "Finished" in result

    def search_sellers(self) -> int:
        self.logger.info("Memulai misi ekspansi Marketplace (Tokopedia).")
        applied = 0
        
        if not self._is_logged_in("tokopedia"):
            self.logger.error("Tokopedia belum login. Agen Marketplace dihentikan sementara. Harap login manual di Cloak Browser.")
            return 0
            
        keyword = random.choice(["kue kering", "brownies lumer", "keripik pedas"])
        url = f"https://www.tokopedia.com/search?st=product&q={keyword.replace(' ', '%20')}"
        
        self.logger.info(f"Mencari produk '{keyword}' di Tokopedia...")
        
        result = self.browser.execute_task(
            f"Buka {url} secara langsung. "
            "Scroll ke bawah perlahan. Cari produk makanan/kue yang fotonya terlihat profesional dan bagus, "
            "TETAPI belum ada tulisan 'Terjual' (atau terjual 0 / belum ada rating). "
            "Klik produk tersebut. "
            "Setelah halaman produk terbuka, baca dan salin 'Nama Toko', 'Nama Produk', dan 'Deskripsi Produk' mereka (terutama jika deskripsinya sangat sepi/kaku). "
            "Gunakan aksi 'done' dengan result JSON: {'store_name': '...', 'product_name': '...', 'description': '...'} "
            "Jika tidak menemukan produk yang cocok, gunakan aksi 'done' dengan result 'NO_TARGET_FOUND'.",
            max_steps=18
        )
        
        if isinstance(result, str) and ("NO_TARGET_FOUND" in result):
            self.logger.info(f"Tidak ada seller sepi potensial untuk '{keyword}'.")
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
            
            if data and data.get("store_name"):
                store_name = data.get("store_name", "Seller Tokopedia")
                product_name = data.get("product_name", "Produk Anda")
                desc = data.get("description", "")
                
                self.logger.info(f"Target Tokopedia Ditemukan! Toko: {store_name}, Produk: {product_name}")
                
                # Generate Solusi ala Evan Fisher via LLM
                chat_text = self._generate_seller_chat(store_name, product_name, desc)
                self.logger.info(f"Draft Chat Disiapkan:\n{chat_text}")
                
                # Auto-Chat the draft to the seller
                self.logger.info("Mengeksekusi pengiriman Chat otomatis ke Seller Tokopedia...")
                chat_result = self.browser.execute_task(
                    f"Ini adalah halaman produk target. Cari dan klik tombol 'Chat' atau icon balon percakapan untuk menghubungi penjual. "
                    f"Tunggu sampai kotak chat terbuka, lalu ketikkan pesan penawaran ini:\n\n{chat_text}\n\n"
                    "Tekan Enter atau klik tombol Kirim. "
                    "Setelah pesan terkirim, gunakan aksi 'done' dengan result 'CHAT_SENT'.",
                    max_steps=6
                )
                self.logger.info(f"Status Pengiriman Chat: {chat_result}")
                applied += 1
                
        except Exception as e:
            self.logger.error(f"Gagal memproses target Marketplace: {e}")
            
        return applied

    def _generate_seller_chat(self, store_name: str, product_name: str, description: str) -> str:
        self.logger.info("Men-generate chat penawaran Seller via LLM...")
        prompt = (
            f"Kamu adalah Evan Fisher. Kamu baru saja menemukan produk '{product_name}' dari toko '{store_name}' di Tokopedia. "
            f"Fotonya bagus, tapi belum ada yang beli. Ini deskripsi asli mereka: \"{description}\"\n\n"
            f"TUGAS:\n"
            f"Buatkan draft chat singkat (maksimal 4 kalimat). Beritahu mereka bahwa foto mereka sudah pantas laris, "
            f"tapi deskripsi mereka gagal membuat calon pembeli ngiler (evaluasi tajam). "
            f"Berikan mereka 1 contoh kalimat deskripsi baru yang jauh lebih 'menjual' secara gratis, "
            f"lalu akhiri dengan menawarkan jasa jika mereka ingin etalasenya dirombak total."
        )
        try:
            response = self.llm.generate_content(prompt)
            if response: return response
            return "Halo min, fotonya bagus tapi deskripsinya kurang SEO. Coba DM ya."
        except Exception as e:
            return "Halo, saya bisa bantu merombak deskripsi toko ini jadi lebih menjual."
