import logging
import time
import json
import random
import os
from browser_agent import BrowserAgent
from identity_manager import IdentityManager

# Path ke file deduplikasi target
SENT_TARGETS_PATH = os.path.join(os.path.dirname(__file__), "client_memory.json")

def _load_sent_targets() -> list:
    """Muat daftar akun yang sudah pernah di-DM."""
    try:
        with open(SENT_TARGETS_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def _save_sent_targets(targets: list):
    """Simpan daftar akun yang sudah pernah di-DM."""
    with open(SENT_TARGETS_PATH, "w") as f:
        json.dump(targets, f)

class InstagramAgent:
    def __init__(self, browser_agent: BrowserAgent, llm_client, hermes_agent=None):
        self.browser = browser_agent
        self.llm = llm_client
        self.identity = IdentityManager()
        self.hermes = hermes_agent
        self.logger = logging.getLogger(__name__)
        self.sent_targets = _load_sent_targets()

    def _is_logged_in(self) -> bool:
        result = self.browser.execute_task(
            "Buka https://www.instagram.com/ secara langsung lalu periksa apakah kamu sudah login. "
            "Tanda login biasanya ada feed, tombol Home, Search, Explore, atau ikon Profil kamu di sidebar kiri. "
            "Gunakan aksi 'done' dengan result 'LOGGED_IN' jika terlihat sudah login, atau 'NOT_LOGGED_IN' jika belum/diminta login.",
            max_steps=5
        )
        return "LOGGED_IN" in result or "Finished" in result

    def search_and_execute_missions(self) -> int:
        self.logger.info("Memulai misi pencarian Toko F&B di Instagram (UI Browser).")
        applied = 0
        
        if not self._is_logged_in():
            self.logger.error("Instagram belum login. Agen Instagram dihentikan sementara. Harap login manual di Cloak Browser.")
            return 0
            
        # UPGRADE E: Hashtag diperluas dari 4 → 20 untuk jangkauan lebih luas
        hashtags = [
            "jualkue", "brownieskukus", "kulinermurah", "jajananpasar",
            "minumanviral", "usahamakanan", "jualanmakanan", "kulinernusantara",
            "makananrumahan", "cateringmurah", "jualkopi", "umkmkuliner",
            "jualroti", "jualsambal", "snackmurah", "frozenfood",
            "jualkripik", "kueultah", "rotikering", "jualkueonline"
        ]
        target_tag = random.choice(hashtags)
        url = f"https://www.instagram.com/explore/tags/{target_tag}/"
        
        # Buat daftar akun yang sudah di-DM untuk dihindari
        already_sent_list = ", ".join(self.sent_targets[-20:]) if self.sent_targets else "belum ada"
        
        self.logger.info(f"Mencari postingan terbaru di hashtag #{target_tag}...")
        
        # UPGRADE B: Filter anti-influencer ditambahkan ke prompt
        result = self.browser.execute_task(
            f"Buka {url} secara langsung. "
            "Ini adalah halaman hashtag Instagram. Scroll ke bawah dan cari postingan yang merupakan jualan makanan/minuman UMKM. "
            "Klik pada salah satu postingan gambar produk makanan yang terlihat menarik. "
            "Setelah postingan terbuka, baca caption-nya. "
            "\n\nATURAN WAJIB PEMILIHAN TARGET:"
            "\n- HANYA pilih akun TOKO/UMKM yang MENJUAL produk makanan/minuman SENDIRI."
            "\n- JANGAN pilih akun food blogger, food reviewer, atau influencer."
            "\n- Tanda influencer: follower >50K, bio berisi 'endorse/collab/paid promote/food blogger/reviewer/jastip', "
            "atau postingan berisi review restoran orang lain (bukan jualan sendiri)."
            f"\n- JANGAN pilih akun yang sudah pernah dikirim DM: [{already_sent_list}]"
            "\n\nJika caption-nya terlihat sangat seadanya, generic, kaku, atau kurang menarik (tidak ada copywriting bagus), "
            "salin 'Nama Akun Toko', 'Asumsi Nama Produk' (berdasarkan gambar/caption), dan 'Caption Asli'. "
            "Gunakan aksi 'done' dengan result JSON: {'store_name': '...', 'product_name': '...', 'caption': '...'} "
            "Jika semua caption terlihat sangat bagus atau profesional, cari postingan lain. "
            "Jika benar-benar tidak menemukan yang cocok setelah beberapa kali scroll/klik, gunakan aksi 'done' dengan result 'NO_TARGET_FOUND'.",
            max_steps=20
        )
        
        if isinstance(result, str) and ("NO_TARGET_FOUND" in result):
            self.logger.info(f"Tidak ada toko potensial di hashtag #{target_tag}.")
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
                store_name = data.get("store_name", "Toko IG")
                product_name = data.get("product_name", "Produk Anda")
                caption = data.get("caption", "")
                
                # UPGRADE G: Deduplikasi — skip jika sudah pernah di-DM
                clean_name = store_name.lower().replace("@", "").strip()
                if clean_name in self.sent_targets:
                    self.logger.warning(f"SKIP: Akun @{store_name} sudah pernah di-DM sebelumnya!")
                    return applied
                
                self.logger.info(f"Target Instagram Ditemukan! Akun: {store_name}, Produk: {product_name}")
                
                # UPGRADE D+F: DM pendek (<150 kata), tanpa nama Evan Fisher
                portfolio = self._generate_portfolio(store_name, product_name, caption)
                self.logger.info(f"Portofolio Disiapkan:\n{portfolio}")
                
                # UPGRADE C: Verifikasi DM gagal/diblokir
                self.logger.info("Mengeksekusi pengiriman DM otomatis ke Instagram...")
                dm_result = self.browser.execute_task(
                    f"Ini adalah postingan target toko '{store_name}'. Buka profil Instagram mereka (klik foto profil atau username-nya). "
                    f"Di halaman profil mereka, cari dan klik tombol 'Message' atau 'Kirim Pesan'. "
                    f"Jika muncul modal/popup, ketikkan pesan ini secara utuh:\n\n{portfolio}\n\n"
                    "Lalu tekan Enter atau klik tombol Send/Kirim. "
                    "Setelah mengirim, PERIKSA apakah ada pesan error seperti 'This account can\\'t receive your message', "
                    "'couldn\\'t send', 'Message request', atau tanda gagal lainnya. "
                    "Jika ada error/gagal, gunakan aksi 'done' dengan result 'DM_BLOCKED'. "
                    "Jika berhasil terkirim tanpa error, gunakan aksi 'done' dengan result 'DM_SENT'.",
                    max_steps=10
                )
                self.logger.info(f"Status Pengiriman DM: {dm_result}")
                
                # Catat hasil ke memory
                if isinstance(dm_result, str) and "DM_SENT" in dm_result:
                    self.sent_targets.append(clean_name)
                    _save_sent_targets(self.sent_targets)
                    self.logger.info(f"✅ DM berhasil terkirim ke @{store_name}! Total DM terkirim: {len(self.sent_targets)}")
                    applied += 1
                elif isinstance(dm_result, str) and "DM_BLOCKED" in dm_result:
                    self.sent_targets.append(clean_name)  # Tetap catat agar tidak dicoba ulang
                    _save_sent_targets(self.sent_targets)
                    self.logger.warning(f"❌ DM ke @{store_name} DIBLOKIR/GAGAL. Akun dicatat agar tidak dicoba lagi.")
                else:
                    self.logger.warning(f"⚠️ Status DM tidak jelas: {dm_result}")
                
        except Exception as e:
            self.logger.error(f"Gagal memproses target Instagram: {e}")
            
        return applied

    def _generate_portfolio(self, store_name: str, product_name: str, original_caption: str) -> str:
        """
        UPGRADE D+F: Generate DM pendek (<150 kata), tanpa nama Evan Fisher.
        Fokus: Salam → 1 kelemahan → 1 solusi → CTA pendek.
        """
        self.logger.info("Men-generate DM pendek via LLM...")
        prompt = (
            f"Kamu adalah konsultan copywriting makanan profesional Indonesia.\n"
            f"Toko Instagram '@{store_name}' menjual '{product_name}'.\n"
            f"Caption asli mereka: \"{original_caption}\"\n\n"
            f"TUGAS: Buatkan 1 pesan DM Instagram yang SINGKAT dan MEMIKAT.\n\n"
            f"ATURAN KETAT:\n"
            f"- MAKSIMAL 120 kata (jangan lebih!)\n"
            f"- Bahasa Indonesia santai tapi profesional\n"
            f"- Struktur: Salam + sebut nama toko → 1 kelemahan spesifik caption mereka (1 kalimat) → "
            f"1 contoh perbaikan caption singkat → CTA: 'Mau saya buatkan 3 caption gratis lagi?'\n"
            f"- JANGAN pakai nama asing atau bahasa Inggris berlebihan\n"
            f"- JANGAN buat artikel, deskripsi produk, atau tips panjang\n"
            f"- Tulis HANYA pesan DM-nya saja, tanpa judul/header/label\n"
            f"- Akhiri dengan emoji yang ramah\n\n"
            f"Contoh format:\n"
            f"Halo kak @[nama], saya perhatiin [produk]-nya kelihatan enak banget! "
            f"Sayang captionnya kurang nendang, kurang bikin orang langsung pengen beli. "
            f"Coba bandingkan: [contoh caption baru yang lebih menarik, 1-2 kalimat]. "
            f"Mau saya buatkan 3 caption gratis lagi khusus buat produk kakak? 😊"
        )
        try:
            response = self.llm.generate_content(prompt)
            if response:
                # Potong jika terlalu panjang (safety net)
                words = response.split()
                if len(words) > 160:
                    response = " ".join(words[:150]) + "... 😊"
                return response
        except Exception as e:
            self.logger.error(f"LLM Generation gagal: {e}")
        return (
            f"Halo kak @{store_name}, saya lihat {product_name}-nya kelihatan enak banget! "
            f"Sayang captionnya kurang nendang buat narik pembeli. "
            f"Mau saya buatkan 3 caption gratis khusus buat produk kakak? 😊"
        )
