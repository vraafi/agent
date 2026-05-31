"""
instagram_agent_v2.py — Nexus DualBrain AI
============================================
VERSI TURBO: 10x lebih cepat dari v1

Perbedaan fundamental:
  v1: Gemma AI mengontrol SETIAP klik mouse (28 API calls per DM = 15-25 menit)
  v2: Playwright langsung navigasi/klik/ketik (2 API calls per DM = 2-3 menit)

AI hanya dipakai untuk 2 hal:
  1. Membaca caption dan menilai kualitasnya
  2. Men-generate DM pendek yang menarik

Semua navigasi (buka hashtag, klik post, buka profil, buka DM, ketik, kirim)
dilakukan langsung oleh Playwright TANPA AI.
"""

import asyncio
import json
import logging
import os
import random
import time
from typing import Optional

logger = logging.getLogger(__name__)

SENT_TARGETS_PATH = os.path.join(os.path.dirname(__file__), "client_memory.json")

def _load_sent_targets() -> list:
    try:
        with open(SENT_TARGETS_PATH, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []

def _save_sent_targets(targets: list):
    with open(SENT_TARGETS_PATH, "w") as f:
        json.dump(targets, f)


# Daftar hashtag (20 variasi)
HASHTAGS = [
    "jualkue", "brownieskukus", "kulinermurah", "jajananpasar",
    "minumanviral", "usahamakanan", "jualanmakanan", "kulinernusantara",
    "makananrumahan", "cateringmurah", "jualkopi", "umkmkuliner",
    "jualroti", "jualsambal", "snackmurah", "frozenfood",
    "jualkripik", "kueultah", "rotikering", "jualkueonline"
]


class InstagramAgentV2:
    """
    Instagram outreach agent TURBO.
    Menggunakan Playwright langsung untuk navigasi, AI hanya untuk analisis & copywriting.
    """

    def __init__(self, llm_client):
        self.llm = llm_client
        self.sent_targets = _load_sent_targets()
        self.pw = None
        self.browser = None
        self.page = None

    async def _ensure_browser(self):
        """Pastikan browser Playwright terhubung via CDP."""
        if self.page:
            return

        from playwright.async_api import async_playwright
        import urllib.request

        self.pw = await async_playwright().start()

        # Cari CDP URL
        cdp_candidates = [
            os.environ.get("BRAVE_CDP_URL", "").strip(),
            "http://127.0.0.1:9223",
        ]

        cdp_url = None
        for url in cdp_candidates:
            if not url:
                continue
            try:
                req = urllib.request.urlopen(f"{url}/json/version", timeout=2)
                if req.status == 200:
                    cdp_url = url
                    break
            except Exception:
                continue

        if not cdp_url:
            raise RuntimeError("Brave browser tidak ditemukan di CDP port 9223. Pastikan sudah berjalan.")

        logger.info("[IG_V2] Menghubungkan ke Brave CDP: %s", cdp_url)
        self.browser = await self.pw.chromium.connect_over_cdp(cdp_url)
        context = self.browser.contexts[0] if self.browser.contexts else await self.browser.new_context()
        self.page = context.pages[0] if context.pages else await context.new_page()

        # Stealth
        try:
            from playwright_stealth import stealth_async
            await stealth_async(self.page)
        except ImportError:
            pass

    async def _is_logged_in(self) -> bool:
        """Cek login Instagram TANPA AI — cukup periksa URL dan elemen."""
        try:
            await self.page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=15000)
            await self.page.wait_for_timeout(2000)

            # Jika ada tombol login, berarti belum login
            login_btn = await self.page.query_selector('a[href="/accounts/login/"]')
            if login_btn:
                return False

            # Cek apakah ada sidebar/nav yang menandakan sudah login
            nav = await self.page.query_selector('nav, [role="navigation"]')
            return nav is not None
        except Exception as e:
            logger.error("[IG_V2] Gagal cek login: %s", e)
            return False

    async def _find_target_from_hashtag(self, hashtag: str) -> Optional[dict]:
        """
        Buka halaman hashtag, klik post, ambil username & caption.
        TANPA AI — murni Playwright.
        """
        url = f"https://www.instagram.com/explore/tags/{hashtag}/"
        logger.info("[IG_V2] Membuka hashtag #%s...", hashtag)

        try:
            await self.page.goto(url, wait_until="domcontentloaded", timeout=20000)
            await self.page.wait_for_timeout(3000)

            # Scroll sedikit untuk load lebih banyak post
            await self.page.mouse.wheel(0, 600)
            await self.page.wait_for_timeout(1500)

            # Cari semua thumbnail post (gambar di grid)
            posts = await self.page.query_selector_all('article a[href*="/p/"], main a[href*="/p/"]')
            if not posts:
                # Fallback: cari semua link yang mengarah ke post
                posts = await self.page.query_selector_all('a[href*="/p/"]')

            if not posts:
                logger.warning("[IG_V2] Tidak ada post ditemukan di #%s", hashtag)
                return None

            # Pilih post secara random dari 3-15 pertama (hindari yang terlalu atas/populer)
            start_idx = min(3, len(posts) - 1)
            end_idx = min(15, len(posts))
            random_post = posts[random.randint(start_idx, end_idx - 1)]

            # Klik post
            await random_post.click()
            await self.page.wait_for_timeout(3000)

            # Ambil username dari halaman post
            username_el = await self.page.query_selector(
                'article header a[href*="/"], '
                'div[role="dialog"] header a[href*="/"]'
            )
            username = ""
            if username_el:
                username = (await username_el.inner_text()).strip().replace("@", "")

            if not username:
                # Fallback: ambil dari URL profil di header
                href = await username_el.get_attribute("href") if username_el else ""
                if href:
                    username = href.strip("/").split("/")[-1]

            # Ambil caption
            caption_el = await self.page.query_selector(
                'article div[role="presentation"] span, '
                'div[role="dialog"] ul li span, '
                'article ul li:first-child span'
            )
            caption = ""
            if caption_el:
                caption = (await caption_el.inner_text()).strip()[:500]

            if not username:
                logger.warning("[IG_V2] Gagal ambil username dari post")
                # Tutup dialog
                await self.page.keyboard.press("Escape")
                return None

            # Cek deduplikasi
            clean_name = username.lower().strip()
            if clean_name in self.sent_targets:
                logger.warning("[IG_V2] SKIP: @%s sudah pernah di-DM", username)
                await self.page.keyboard.press("Escape")
                return None

            # Tutup dialog post
            await self.page.keyboard.press("Escape")
            await self.page.wait_for_timeout(1000)

            return {
                "store_name": username,
                "product_name": "produk makanan",  # akan di-infer dari caption oleh AI
                "caption": caption
            }

        except Exception as e:
            logger.error("[IG_V2] Error navigasi hashtag: %s", e)
            return None

    def _evaluate_caption_with_ai(self, caption: str) -> bool:
        """
        AI Call #1: Evaluasi apakah caption ini layak ditargetkan.
        Return True jika caption jelek (layak ditarget), False jika bagus (skip).
        """
        if not caption or len(caption) < 10:
            return True  # Caption sangat pendek = target

        prompt = (
            f"Evaluasi caption Instagram ini dalam 1 kata: JELEK atau BAGUS.\n"
            f"Caption: \"{caption[:300]}\"\n\n"
            f"JELEK = caption seadanya, kaku, tidak ada CTA, tidak menarik, atau terlalu curhat.\n"
            f"BAGUS = caption profesional, ada CTA, copywriting menarik.\n"
            f"Balas HANYA dengan 1 kata: JELEK atau BAGUS."
        )
        try:
            result = self.llm.generate_content(prompt)
            if result and "BAGUS" in result.upper():
                return False  # Caption bagus, skip
        except Exception:
            pass
        return True  # Default: targetkan

    def _generate_short_dm(self, store_name: str, product_name: str, caption: str) -> str:
        """
        AI Call #2: Generate DM pendek (<120 kata).
        """
        prompt = (
            f"Buatkan 1 pesan DM Instagram SINGKAT untuk toko '@{store_name}'.\n"
            f"Produk mereka: {product_name}\n"
            f"Caption asli: \"{caption[:200]}\"\n\n"
            f"ATURAN:\n"
            f"- MAKSIMAL 100 kata\n"
            f"- Bahasa Indonesia santai tapi profesional\n"
            f"- Sebut nama toko di awal\n"
            f"- Sebutkan 1 kelemahan spesifik caption mereka (1 kalimat)\n"
            f"- Berikan 1 contoh caption pengganti yang lebih menarik (1-2 kalimat)\n"
            f"- Akhiri dengan: 'Mau saya buatkan 3 caption gratis lagi khusus buat produk kakak?'\n"
            f"- Tulis HANYA pesan DM-nya, tanpa judul/label\n"
            f"- Akhiri dengan emoji ramah"
        )
        try:
            result = self.llm.generate_content(prompt)
            if result:
                words = result.split()
                if len(words) > 130:
                    result = " ".join(words[:120]) + " 😊"
                return result
        except Exception as e:
            logger.error("[IG_V2] Gagal generate DM: %s", e)

        return (
            f"Halo kak @{store_name}, saya lihat produknya kelihatan enak banget! "
            f"Sayang captionnya kurang nendang buat narik pembeli. "
            f"Mau saya buatkan 3 caption gratis khusus buat produk kakak? 😊"
        )

    async def _send_dm(self, username: str, message: str) -> str:
        """
        Kirim DM ke username TANPA AI — murni Playwright.
        Return: 'DM_SENT', 'DM_BLOCKED', atau 'DM_FAILED'
        """
        try:
            # 1. Buka profil target
            profile_url = f"https://www.instagram.com/{username}/"
            logger.info("[IG_V2] Membuka profil @%s...", username)
            await self.page.goto(profile_url, wait_until="domcontentloaded", timeout=15000)
            await self.page.wait_for_timeout(2000)

            # 2. Cek apakah profil ada (bukan 404)
            page_text = await self.page.inner_text("body")
            if "Sorry, this page" in page_text or "aren't available" in page_text:
                logger.warning("[IG_V2] Profil @%s tidak ditemukan (404)", username)
                return "DM_FAILED"

            # 3. Cari tombol "Message"
            message_btn = await self.page.query_selector(
                'div[role="button"]:has-text("Message"), '
                'button:has-text("Message"), '
                'div[role="button"]:has-text("Kirim Pesan")'
            )

            if not message_btn:
                # Fallback: cari semua button-like elements
                all_btns = await self.page.query_selector_all('div[role="button"], button')
                for btn in all_btns:
                    text = (await btn.inner_text()).strip().lower()
                    if text in ("message", "kirim pesan"):
                        message_btn = btn
                        break

            if not message_btn:
                logger.warning("[IG_V2] Tombol Message tidak ditemukan di @%s (mungkin akun privat)", username)
                return "DM_BLOCKED"

            # 4. Klik tombol Message
            try:
                # Kadang elemen tidak stabil, gunakan JS click
                await self.page.evaluate("(el) => el.click()", message_btn)
            except Exception as e:
                logger.warning("[IG_V2] Normal click gagal, mencoba click fallback: %s", e)
                await message_btn.click()
            
            await self.page.wait_for_timeout(5000)

            # 5. Cari text area DM (coba 10 detik)
            dm_input = None
            for i in range(10):
                dm_input = await self.page.query_selector(
                    'textarea[placeholder*="Message"], '
                    'div[role="textbox"][contenteditable="true"], '
                    'textarea[placeholder*="Pesan"]'
                )
                if dm_input:
                    break
                await self.page.wait_for_timeout(1000)

            if not dm_input:
                logger.warning("[IG_V2] Input DM tidak ditemukan untuk @%s", username)
                try:
                    body = await self.page.inner_html('body')
                    with open(f"C:\\Users\\user\\.gemini\\antigravity\\brain\\d70f0f4b-a00f-47fc-b3c4-a1aa47aa935e\\scratch\\fail_dm_{username}.html", "w", encoding="utf-8") as f:
                        f.write(body)
                except Exception as e:
                    logger.error("Gagal dump DOM: %s", e)
                return "DM_FAILED"

            # 6. Ketik pesan — gunakan fallback clipboardEvent jika perlu
            await dm_input.click()
            await self.page.wait_for_timeout(500)

            try:
                # Menghindari error Playwright ketika teks terlalu panjang atau terpotong
                await self.page.evaluate('''([el, text]) => {
                    const dataTransfer = new DataTransfer();
                    dataTransfer.setData('text/plain', text);
                    el.dispatchEvent(new ClipboardEvent('paste', {
                        clipboardData: dataTransfer,
                        bubbles: true,
                        cancelable: true
                    }));
                }''', [dm_input, message])
            except Exception:
                await self.page.keyboard.type(message, delay=15)
                
            await self.page.wait_for_timeout(1000)

            # 7. Tekan Enter untuk kirim
            await self.page.keyboard.press("Enter")
            await self.page.wait_for_timeout(3000)

            # 8. Verifikasi: cek apakah ada error message
            body_text = await self.page.inner_text("body")
            error_indicators = [
                "can't receive", "couldn't send", "try again",
                "tidak dapat menerima", "gagal mengirim"
            ]
            for indicator in error_indicators:
                if indicator.lower() in body_text.lower():
                    logger.warning("[IG_V2] DM ke @%s DIBLOKIR: %s", username, indicator)
                    return "DM_BLOCKED"

            logger.info("[IG_V2] ✅ DM berhasil terkirim ke @%s!", username)
            return "DM_SENT"

        except Exception as e:
            logger.error("[IG_V2] Error kirim DM ke @%s: %s", username, e)
            return "DM_FAILED"

    async def run_single_mission(self) -> bool:
        """
        Jalankan 1 misi lengkap: cari target → evaluasi → generate DM → kirim.
        Return True jika DM terkirim.
        """
        await self._ensure_browser()

        # Cek login
        if not await self._is_logged_in():
            logger.error("[IG_V2] Instagram belum login! Login manual dulu.")
            return False

        # Pilih hashtag random
        hashtag = random.choice(HASHTAGS)

        # Cari target (TANPA AI — Playwright langsung)
        target = await self._find_target_from_hashtag(hashtag)
        if not target:
            return False

        store_name = target["store_name"]
        caption = target["caption"]
        product_name = target["product_name"]

        logger.info("[IG_V2] Target: @%s | Caption: %s...", store_name, caption[:80])

        # AI Call #1: Evaluasi caption (singkat, 1 API call)
        if not self._evaluate_caption_with_ai(caption):
            logger.info("[IG_V2] Caption @%s sudah bagus, skip.", store_name)
            return False

        # AI Call #2: Generate DM pendek (1 API call)
        dm_message = self._generate_short_dm(store_name, product_name, caption)
        logger.info("[IG_V2] DM disiapkan (%d kata)", len(dm_message.split()))

        # Kirim DM (TANPA AI — Playwright langsung)
        result = await self._send_dm(store_name, dm_message)

        # Catat ke memory
        clean_name = store_name.lower().strip()
        self.sent_targets.append(clean_name)
        _save_sent_targets(self.sent_targets)

        if result == "DM_SENT":
            logger.info("[IG_V2] ✅ SUKSES! Total DM terkirim: %d", len(self.sent_targets))
            return True
        else:
            logger.warning("[IG_V2] ❌ DM gagal/diblokir untuk @%s. Lanjut ke target lain.", store_name)
            return False

    async def run_batch(self, target_count: int = 30):
        """Jalankan batch misi sampai target tercapai."""
        await self._ensure_browser()

        # Inisialisasi Inbox Agent
        from instagram_inbox_agent import InstagramInboxAgent
        inbox_agent = InstagramInboxAgent(self.llm)

        sent = 0
        attempts = 0
        max_attempts = target_count * 3  # Max 3x percobaan per target

        logger.info("[IG_V2] ===== MEMULAI BATCH %d DM =====", target_count)

        while sent < target_count and attempts < max_attempts:
            attempts += 1
            logger.info("[IG_V2] --- Misi %d (DM terkirim: %d/%d) ---", attempts, sent, target_count)

            try:
                success = await self.run_single_mission()
                if success:
                    sent += 1

                # Cek inbox setiap 3 percobaan
                if attempts % 3 == 0:
                    logger.info("[IG_V2] Waktunya mengecek Inbox untuk balasan klien...")
                    await inbox_agent.check_inbox()

                # Jeda anti-shadowban: 30-90 detik
                delay = random.randint(30, 90)
                logger.info("[IG_V2] Jeda %d detik sebelum misi berikutnya...", delay)
                await asyncio.sleep(delay)

            except Exception as e:
                logger.error("[IG_V2] Error di misi %d: %s", attempts, e)
                await asyncio.sleep(10)

        logger.info("[IG_V2] ===== BATCH SELESAI: %d DM terkirim dari %d percobaan =====", sent, attempts)

    async def cleanup(self):
        if self.pw:
            await self.pw.stop()


# ─────────────────────────────────────────────────────────────────────────────
# ENTRYPOINT
# ─────────────────────────────────────────────────────────────────────────────

def main():
    import os
    from dotenv import load_dotenv
    from api_client import GeminiClient

    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    load_dotenv()

    api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
    if not api_keys:
        api_keys = [os.environ.get("GEMINI_API_KEY")]

    llm = GeminiClient(api_keys)
    agent = InstagramAgentV2(llm_client=llm)

    print("=" * 50)
    print("NEXUS IG TURBO v2 — 10x LEBIH CEPAT")
    print("=" * 50)
    print("AI hanya untuk analisis caption & generate DM.")
    print("Navigasi 100% Playwright langsung.\n")

    try:
        asyncio.run(agent.run_batch(target_count=30))
    except KeyboardInterrupt:
        print("\nDihentikan oleh user.")
    finally:
        asyncio.run(agent.cleanup())


if __name__ == "__main__":
    main()
