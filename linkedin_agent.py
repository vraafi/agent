"""
linkedin_agent.py — Nexus DualBrain AI
=========================================
Agen LinkedIn: navigasi ke linkedin.com, cari lowongan (python, scraping, data),
Menggunakan Playwright-native untuk navigasi yang reliable + LLM untuk form filling.
"""

import logging
import time
import asyncio
from browser_agent import BrowserAgent
from identity_manager import IdentityManager
import json
import os

logger = logging.getLogger(__name__)

LINKEDIN_MEMORY_PATH = os.path.join(os.path.dirname(__file__), "linkedin_memory.json")

def _load_linkedin_memory() -> dict:
    try:
        with open(LINKEDIN_MEMORY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

def _save_linkedin_memory(mem: dict):
    with open(LINKEDIN_MEMORY_PATH, "w", encoding="utf-8") as f:
        json.dump(mem, f, indent=4)


class LinkedinAgent:
    def __init__(self, browser_agent: BrowserAgent, llm_client, hermes_agent=None, dry_run=False):
        self.browser = browser_agent
        self.llm = llm_client
        self.identity = IdentityManager()
        self.hermes = hermes_agent
        self.logger = logging.getLogger(__name__)
        self.replied_memory = _load_linkedin_memory()
        self.dry_run = dry_run
        
        # Cek apakah sudah posting hari ini
        import datetime
        self.today_str = datetime.datetime.now().strftime("%Y-%m-%d")
        if self.replied_memory.get("last_posted_date") == self.today_str:
            self.has_posted_news = True
        else:
            self.has_posted_news = False
            
        self.last_analytics_time = self.replied_memory.get("last_analytics_time", 0)

    def analyze_post_performance(self) -> None:
        if time.time() - self.last_analytics_time < 6 * 3600:
            return
            
        self.logger.info("Memulai evaluasi analitik postingan LinkedIn (Feedback Loop 6-Jam)...")
        
        if not self.dry_run:
            if not self.login_linkedin():
                return
                
        # Gunakan BrowserAgent untuk membaca aktivitas terbaru
        result = self.browser.execute_task(
            "Buka https://www.linkedin.com/in/me/recent-activity/all/ "
            "Scroll ke bawah dan baca SELURUH postingan yang dibuat oleh profil ini. "
            "Untuk setiap postingan, catat: (1) Teks atau isi postingan, (2) Jumlah Likes/Reactions, (3) Jumlah Comments. "
            "Gunakan aksi 'done' dan kembalikan result dalam bentuk teks ringkasan (misalnya 'Post 1: [teks] | Likes: 10 | Comments: 2'). "
            "Jika halaman tidak valid, profil tidak ditemukan, atau tidak ada postingan, kembalikan 'FAILED'.",
            max_steps=15
        )
        
        if "FAILED" in result or "error" in result.lower():
            self.logger.warning("Gagal mengambil data analitik postingan (mungkin tidak ada post).")
        else:
            self.logger.info("Menganalisis performa postingan untuk mendapatkan *writing guidelines* baru...")
            analytics_prompt = (
                "You are an elite copywriter and data analyst. Review the following recent LinkedIn posts and their engagement metrics (likes/comments):\n\n"
                f"{result}\n\n"
                "Analyze which types of posts, hooks, or structures received higher engagement, and which ones failed. "
                "Based on this real-world data, extract exactly 3 concise, actionable writing guidelines to improve future posts. "
                "These guidelines MUST NOT violate the Evan Fisher rules (e.g. short sentences, no 'I' in first sentence, must have summary and CTA). "
                "Format the output strictly as a bulleted list of 3 guidelines."
            )
            
            guidelines = self.llm.generate_content(analytics_prompt)
            if guidelines:
                guidelines_path = os.path.join(os.path.dirname(__file__), "linkedin_writing_guidelines.txt")
                with open(guidelines_path, "w", encoding="utf-8") as f:
                    f.write(guidelines)
                self.logger.info("Feedback loop selesai. Guidelines baru berhasil disimpan.")
                
        self.last_analytics_time = time.time()
        self.replied_memory["last_analytics_time"] = self.last_analytics_time
        _save_linkedin_memory(self.replied_memory)

    def _is_logged_in(self) -> bool:
        result = self.browser.execute_task(
            "Buka https://www.linkedin.com/feed/ lalu periksa apakah kamu sudah login. "
            "Tanda login biasanya ada avatar, nama profil, atau feed postingan. "
            "Gunakan aksi 'done' dengan result 'LOGGED_IN' jika terlihat, atau 'NOT_LOGGED_IN' jika tidak.",
            max_steps=3
        )
        return result == "LOGGED_IN" or "Finished" in result

    def login_linkedin(self) -> bool:
        self.logger.info("Bypassing LLM login check as per user confirmation. Assuming LOGGED_IN.")
        return True

    def search_and_execute_missions(self) -> int:
        """
        Misi pencarian kerja LinkedIn dinonaktifkan.
        Fokus pada strategi Evan Fisher (Inbound marketing via konten & DM).
        Pencarian kerja otomatis dipindahkan ke JobSearchAgent.
        """
        self.logger.info("Pencarian kerja otomatis di LinkedIn dinonaktifkan sesuai instruksi Evan Fisher.")
        return 0

        # =====================================================================
        self.logger.info("[JOB] Step 1: Navigasi ke halaman pencarian (Playwright-native)...")
        
        async def navigate_to_search(page, context):
            search_url = (
                "https://www.linkedin.com/jobs/search/"
                "?keywords=Python%20Scraping%20Automation&f_WT=2&f_AL=true&sortBy=DD"
            )
            await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
            try:
                await page.wait_for_load_state("networkidle", timeout=10000)
            except:
                pass
            await asyncio.sleep(3)
            return "SEARCH_PAGE_LOADED"
        
        result = self.browser.execute_playwright_script(navigate_to_search)
        if "FAILED" in result:
            self.logger.error("[JOB] Gagal navigasi ke halaman pencarian: %s", result)
            time.sleep(30)
            return applied_or_completed
        
        self.logger.info("[JOB] Step 1 selesai: %s", result)

        # =====================================================================
        # Step 2: Cari lowongan Easy Apply dan klik (Playwright-native)
        # =====================================================================
        self.logger.info("[JOB] Step 2: Mencari dan mengklik lowongan Easy Apply (Playwright-native)...")
        
        async def find_and_click_easy_apply_job(page, context):
            """Cari job card dengan 'Melamar mudah' dan klik judulnya."""
            # Tunggu job list muncul
            try:
                await page.wait_for_selector(".jobs-search-results-list", timeout=10000)
            except:
                logger.warning("[Playwright] Job list container tidak ditemukan, coba lanjut...")
            
            await asyncio.sleep(2)
            
            # Cari semua job card
            job_cards = await page.query_selector_all(
                "li.jobs-search-results__list-item, "
                "div.job-card-container, "
                "div[data-job-id], "
                "li[data-occludable-job-id]"
            )
            
            if not job_cards:
                # Fallback: cari via scaffold list
                job_cards = await page.query_selector_all(
                    ".scaffold-layout__list-container li"
                )
            
            logger.info("[Playwright] Ditemukan %d job cards", len(job_cards))
            
            if not job_cards:
                return "NO_EASY_APPLY_FOUND"
            
            # Iterasi job cards, cari yang ada "Melamar mudah" / "Easy Apply"
            for i, card in enumerate(job_cards[:10]):
                try:
                    card_text = await card.inner_text()
                    card_text_lower = card_text.lower()
                    
                    if ("melamar mudah" in card_text_lower or "easy apply" in card_text_lower) and \
                       "dilamar" not in card_text_lower and "applied" not in card_text_lower:
                        logger.info("[Playwright] Job card #%d mengandung Easy Apply: %s", 
                                   i, card_text[:80].replace('\n', ' '))
                        
                        # Klik judul lowongan (link <a> di dalam card)
                        title_link = await card.query_selector(
                            "a.job-card-list__title, "
                            "a.job-card-container__link, "
                            "a[data-control-name='job_card'], "
                            "a strong, "
                            "a.disabled"
                        )
                        
                        if not title_link:
                            # Fallback: klik link <a> pertama di card
                            title_link = await card.query_selector("a")
                        
                        if title_link:
                            await title_link.scroll_into_view_if_needed()
                            await asyncio.sleep(0.5)
                            await title_link.click(force=True, timeout=5000)
                            logger.info("[Playwright] ✅ Berhasil klik judul lowongan Easy Apply!")
                            await asyncio.sleep(3)  # Tunggu panel detail muncul
                            return "JOB_CLICKED"
                        else:
                            # Klik card itu sendiri
                            await card.scroll_into_view_if_needed()
                            await asyncio.sleep(0.5)
                            await card.click(force=True, timeout=5000)
                            logger.info("[Playwright] ✅ Berhasil klik job card Easy Apply!")
                            await asyncio.sleep(3)
                            return "JOB_CLICKED"
                except Exception as e:
                    logger.debug("[Playwright] Error processing card #%d: %s", i, e)
                    continue
            
            return "NO_EASY_APPLY_FOUND"
        
        result = self.browser.execute_playwright_script(find_and_click_easy_apply_job)
        self.logger.info("[JOB] Step 2 result: %s", result)
        
        if "NO_EASY_APPLY_FOUND" in result:
            self.logger.info("Tidak ada lowongan Easy Apply. Cooldown 60s...")
            time.sleep(60)
            return applied_or_completed
        
        if "FAILED" in result:
            self.logger.error("[JOB] Step 2 gagal: %s", result)
            time.sleep(30)
            return applied_or_completed

        # =====================================================================
        # Step 3: Klik tombol "Melamar Mudah" di panel detail (Playwright-native)
        # =====================================================================
        self.logger.info("[JOB] Step 3: Mengklik tombol Melamar Mudah (Playwright-native)...")
        
        async def click_easy_apply_button(page, context):
            """Cari dan klik tombol biru 'Melamar Mudah' di panel detail."""
            
            # Tunggu panel detail muncul
            await asyncio.sleep(2)
            
            # Cari tombol "Melamar mudah" / "Easy Apply" — multiple selectors
            selectors = [
                # Selector paling spesifik: tombol Easy Apply LinkedIn
                "button.jobs-apply-button",
                "button[aria-label*='Melamar']",
                "button[aria-label*='Easy Apply']",
                "button[aria-label*='melamar']",
                # Cari tombol yang mengandung teks
                "button:has-text('Melamar Mudah')",
                "button:has-text('Melamar mudah')",
                "button:has-text('Easy Apply')",
                # Selector dengan class LinkedIn
                ".jobs-apply-button",
                ".jobs-s-apply button",
                # Fallback
                "button.artdeco-button--primary:has-text('Melamar')",
            ]
            
            for selector in selectors:
                try:
                    btn = await page.query_selector(selector)
                    if btn:
                        btn_text = (await btn.inner_text()).strip()
                        is_visible = await btn.is_visible()
                        
                        if is_visible and ("melamar" in btn_text.lower() or "apply" in btn_text.lower()):
                            logger.info("[Playwright] ✅ Tombol ditemukan: '%s' (selector: %s)", btn_text, selector)
                            await btn.scroll_into_view_if_needed()
                            await asyncio.sleep(0.5)
                            await btn.click(force=True, timeout=5000)
                            logger.info("[Playwright] ✅ Tombol 'Melamar Mudah' berhasil diklik!")
                            await asyncio.sleep(3)
                            
                            # Verifikasi modal terbuka
                            modal = await page.query_selector("div[role='dialog'], .artdeco-modal")
                            if modal:
                                return "EASY_APPLY_CLICKED"
                            else:
                                logger.warning("[Playwright] Modal Easy Apply tidak muncul setelah diklik.")
                                return "NO_APPLY_BUTTON"
                except Exception as e:
                    logger.debug("[Playwright] Selector '%s' gagal: %s", selector, e)
                    continue
            
            # Fallback: cari semua tombol dan filter berdasarkan teks
            logger.info("[Playwright] Fallback: mencari tombol via teks...")
            all_buttons = await page.query_selector_all("button")
            for btn in all_buttons:
                try:
                    text = (await btn.inner_text()).strip().lower()
                    if ("melamar" in text or "easy apply" in text or "apply" in text) and \
                       "sudah" not in text and "tidak" not in text and "lihat" not in text and "terkirim" not in text and "applied" not in text:
                        is_visible = await btn.is_visible()
                        if is_visible:
                            logger.info("[Playwright] ✅ Fallback: tombol '%s' ditemukan!", text)
                            await btn.scroll_into_view_if_needed()
                            await asyncio.sleep(0.5)
                            await btn.click(force=True, timeout=5000)
                            logger.info("[Playwright] ✅ Tombol 'Melamar Mudah' (fallback) berhasil diklik!")
                            await asyncio.sleep(3)
                            
                            modal = await page.query_selector("div[role='dialog'], .artdeco-modal")
                            if modal:
                                return "EASY_APPLY_CLICKED"
                            else:
                                return "NO_APPLY_BUTTON"
                except:
                    continue
            
            return "NO_APPLY_BUTTON"
        
        result = self.browser.execute_playwright_script(click_easy_apply_button)
        self.logger.info("[JOB] Step 3 result: %s", result)
        
        if "NO_APPLY_BUTTON" in result:
            self.logger.info("Tombol Easy Apply tidak ditemukan di panel detail.")
            time.sleep(30)
            return applied_or_completed
        
        if "EASY_APPLY_CLICKED" not in result:
            self.logger.warning("[JOB] Step 3 gagal (result: %s). Kembali ke awal.", result)
            time.sleep(30)
            return applied_or_completed

        # Jeda agar form lamaran ter-render
        time.sleep(3)

        # =====================================================================
        # Step 4: Isi form lamaran dan submit (LLM-assisted — form bervariasi)
        # =====================================================================
        self.logger.info("[JOB] Step 4: Mengisi dan mengirim lamaran (LLM-assisted)...")
        result = self.browser.execute_task(
            "TUGAS KAMU SEKARANG: Selesaikan proses pengisian form lamaran pekerjaan (Easy Apply) yang saat ini sudah terbuka di layar.\n"
            "Baca struktur elemen halaman, ketik data yang diperlukan, dan tekan tombol Next hingga lamaran terkirim.\n"
            "ATURAN WAJIB:\n"
            "1. Jika ada field kosong yang WAJIB diisi (tanda *), isi field tersebut SATU KALI SAJA. Untuk First Name: Verdiawan, Last Name: Raafi, Nomor Telepon: +6285723629224.\n"
            "2. KHUSUS Location (city): Gunakan aksi 'type' dengan teks 'Karawang Kulon'. JANGAN ketik seluruh lokasinya secara manual. Pada step selanjutnya, opsi dropdown 'Karawang Kulon, Karawang Barat, Jawa Barat, Indonesia' akan muncul. Gunakan aksi 'click' pada opsi dropdown tersebut!\n"
            "3. Jika ada kolom atau field 'Summary' atau 'Ringkasan', WAJIB isi dengan: 'F&B Marketing Strategist and Copywriter with strong experience in digital marketing, compelling copywriting, and social media management.' sebelum menekan tombol Berikutnya.\n"
            "4. Setelah mengisi field, LANGSUNG klik tombol 'Berikutnya' atau 'Next' atau 'Lanjutkan'. JANGAN mengetik ulang field yang sama!\n"
            "5. PENTING: JANGAN mengira sebuah field sudah terisi hanya karena kamu melihat nama/teks di 'PAGE SUMMARY'. Field HANYA terisi jika di daftar INTERACTIVE ELEMENTS terdapat atribut [value='...'] pada elemen <input> tersebut (contoh: <input> First name [value='Verdiawan']). Jika TIDAK ADA [value='...'], berarti field itu KOSONG dan WAJIB kamu isi dengan aksi 'type'!\n"
            "6. Jika ada tombol 'Submit application' atau 'Kirim lamaran' atau 'Review', KLIK tombol tersebut.\n"
            "7. Jika ada pertanyaan ya/tidak, pilih 'Ya'.\n"
            "8. Jika ditanya 'Berapa tahun pengalaman...', jawab angka saja (misal: '3').\n"
            "9. Jika ada error validasi atau tombol Next tidak mengubah halaman, Cek kembali field yang mandatory (ada tanda *) dan pastikan sudah kamu 'type'. Jika masih nyangkut, ketik ulang field tersebut dengan data yang benar.\n"
            "10. Jika ada tombol upload CV/resume, wajib gunakan aksi 'upload' ke elemen tersebut dengan path file: C:\\Users\\user\\.antigravity\\Nexus-DualBrain-AI\\VERDIAWANRAAFI.pdf\n"
            "11. Setelah lamaran terkirim (pesan 'Application sent' atau 'Lamaran terkirim'), gunakan aksi 'done' dengan result 'JOB_APPLIED'.\n"
            "12. Jika gagal/error setelah beberapa kali coba, gunakan 'done' dengan result 'APPLY_FAILED'.\n"
            "13. ANTI-LOOP PENTING: Jika kamu sudah klik 'Berikutnya' namun halaman tidak berubah, itu berarti ADA ERROR VALIDASI. Cari field input (seperti nomor telepon atau nama), lalu KETIK ULANG field tersebut dengan data yang benar (Phone: +6285723629224), baru klik Next lagi!\n"
            "14. CRITICAL ANTI-LOOP: JIKA FORM EASY APPLY (MODAL/POPUP) TIDAK TERLIHAT DI LAYAR (misalnya kamu hanya melihat daftar lowongan kerja biasa), JANGAN SCROLL MENCARI FORM! Langsung gunakan aksi 'done' dengan result 'NO_FORM'.\n"
            "INGAT: JANGAN PERNAH mengetik field yang sama berkali-kali kecuali terjadi error validasi! Setelah type, LANGSUNG click Next!",
            max_steps=12
        )

        if "JOB_APPLIED" in result:
            self.logger.info("✅ Berhasil melamar pekerjaan di LinkedIn!")
            applied_or_completed += 1
        else:
            self.logger.info("Gagal menyelesaikan lamaran (result: %s). Lanjut ke siklus berikutnya.", result)

        time.sleep(30)
        return applied_or_completed

    def monitor_post_comments_and_reply(self) -> int:
        self.logger.info("Memeriksa komentar baru di postingan (via Notifikasi)...")
        replied_count = 0
        if not self._is_logged_in():
            self.logger.error("LinkedIn belum login. Lewati pengecekan komentar.")
            return 0
            
        async def playwright_reply_comments(page, context):
            try:
                await page.goto("https://www.linkedin.com/notifications/", timeout=30000)
                await __import__('asyncio').sleep(5)
                
                # Cari notifikasi yang mengandung kata "menanggapi" atau "commented"
                notifications = await page.query_selector_all("article.nt-card")
                comment_notifs = []
                for n in notifications:
                    text = (await n.inner_text()).lower()
                    if "menanggapi postingan" in text or "commented on" in text or "mengomentari" in text:
                        comment_notifs.append(n)
                
                if not comment_notifs:
                    return "NO_COMMENT_NOTIFS"
                
                # Klik notifikasi pertama yang valid
                for notif in comment_notifs[:2]: # Proses max 2 notifikasi per siklus
                    await notif.click()
                    await __import__('asyncio').sleep(5)
                    
                    # Scroll ke bawah untuk memuat komentar
                    await page.evaluate("window.scrollBy(0, 500)")
                    await __import__('asyncio').sleep(3)
                    
                    # Cari semua elemen komentar
                    comments = await page.query_selector_all("article.comments-comment-item")
                    for comment in comments:
                        try:
                            commenter_elem = await comment.query_selector("span.comments-post-meta__name-text, span.comments-comment-meta__description-title")
                            text_elem = await comment.query_selector("div.update-components-text")
                            
                            if not commenter_elem or not text_elem:
                                continue
                                
                            commenter_name = (await commenter_elem.inner_text()).strip()
                            comment_text = (await text_elem.inner_text()).strip()
                            
                            if "Verdiawan" in commenter_name:
                                continue
                                
                            mem_key = f"{commenter_name}::{comment_text[:20]}"
                            
                            replied_comments_list = self.replied_memory.get("replied_comments", [])
                            if mem_key in replied_comments_list:
                                continue
                                
                            self.logger.info(f"Komentar baru dari {commenter_name}: {comment_text}")
                            
                            # Kembalikan ke python host untuk LLM call
                            return f"FOUND_COMMENT::{mem_key}::{comment_text}::{commenter_name}"
                            
                        except Exception as ce:
                            self.logger.error(f"Error memproses individual komentar: {ce}")
                            continue
                            
                    # Jika selesai mengecek 1 postingan, kembali ke notifikasi
                    await page.goto("https://www.linkedin.com/notifications/", timeout=30000)
                    await __import__('asyncio').sleep(4)
                    
                return "DONE_CHECKING"
                
            except Exception as e:
                self.logger.error(f"Error Playwright comments check: {e}")
                return "ERROR"
                
        # Jalankan script Playwright
        while True:
            res = self.browser.execute_playwright_script(playwright_reply_comments)
            if isinstance(res, str) and res.startswith("FOUND_COMMENT::"):
                parts = res.split("::", 3)
                mem_key = parts[1]
                comment_text = parts[2]
                commenter_name = parts[3]
                
                # Generate balasan via LLM
                from evan_fisher import EVAN_FISHER_PROMPT
                prompt = (
                    f"You are Verdiawan Raafi. A connection named {commenter_name} commented on your LinkedIn post.\n"
                    f"Their comment: \"{comment_text}\"\n"
                    f"Write a short, engaging reply. Ask a follow-up question if it makes sense to keep the discussion going. "
                    f"DO NOT ask them to DM you unless they explicitly ask for a service. Just discuss.\n"
                    f"Detect their language and reply in the EXACT SAME language.\n\n"
                    f"{EVAN_FISHER_PROMPT}\n"
                    f"Output ONLY the reply text."
                )
                ai_reply = self.llm.generate_content(prompt)
                
                if ai_reply:
                    async def playwright_do_reply(page, context):
                        try:
                            # Kita masih di halaman postingan dari script sebelumnya!
                            comments = await page.query_selector_all("article.comments-comment-item")
                            for comment in comments:
                                commenter_elem = await comment.query_selector("span.comments-post-meta__name-text, span.comments-comment-meta__description-title")
                                text_elem = await comment.query_selector("div.update-components-text")
                                if commenter_elem and text_elem:
                                    c_name = (await commenter_elem.inner_text()).strip()
                                    c_text = (await text_elem.inner_text()).strip()
                                    if c_name == commenter_name and c_text == comment_text:
                                        reply_btn = await comment.query_selector("button.comments-comment-social-bar__reply-action-button, button:has-text('Balas'), button:has-text('Reply')")
                                        if reply_btn:
                                            await reply_btn.click()
                                            await __import__('asyncio').sleep(2)
                                            
                                            editor = await comment.query_selector("div.ql-editor, div.comments-comment-box__form-container div[role='textbox']")
                                            if editor:
                                                teks = ai_reply.replace('\\"', '"').replace('\\n', '\n')
                                                await editor.click()
                                                await page.keyboard.insert_text(teks)
                                                await __import__('asyncio').sleep(2)
                                                
                                                submit_btn = await comment.query_selector("button.comments-comment-box__submit-button")
                                                if submit_btn:
                                                    await submit_btn.click(force=True)
                                                    await __import__('asyncio').sleep(3)
                                                    return "REPLIED_SUCCESS"
                            return "FAILED_TO_FIND_REPLY_BOX"
                        except Exception as e:
                            return f"ERROR_REPLYING: {e}"
                            
                    reply_res = self.browser.execute_playwright_script(playwright_do_reply)
                    if reply_res == "REPLIED_SUCCESS" or "FAILED" in str(reply_res):
                        if reply_res == "REPLIED_SUCCESS":
                            self.logger.info(f"✅ Berhasil membalas komentar {commenter_name}!")
                        else:
                            self.logger.error(f"Gagal mengeksekusi balasan Playwright: {reply_res}. Tetap ditandai replied agar tidak loop.")
                        
                        if "replied_comments" not in self.replied_memory:
                            self.replied_memory["replied_comments"] = []
                        self.replied_memory["replied_comments"].append(mem_key)
                        
                        import json
                        import os
                        from config import SYSTEM_DIR
                        mem_path = os.path.join(SYSTEM_DIR, "linkedin_memory.json")
                        try:
                            with open(mem_path, "w", encoding="utf-8") as f:
                                json.dump(self.replied_memory, f, indent=4)
                        except Exception as e:
                            self.logger.error(f"Gagal menyimpan linkedin_memory.json: {e}")
                            
                        replied_count += 1
            else:
                break
                
        return replied_count

    def check_notifications(self) -> None:
        self.logger.info("Memeriksa notifikasi LinkedIn...")
        self.browser.execute_task(
            "Buka https://www.linkedin.com/notifications/ secara langsung. "
            "Baca sekilas daftar notifikasi yang ada di halaman. "
            "PENTING: Jangan mengeklik notifikasi apapun secara individual karena akan menyebabkan looping! Cukup kunjungi halamannya agar sistem LinkedIn menandainya sebagai telah dibaca. "
            "Langsung gunakan aksi 'done' dengan result 'NOTIFICATIONS_CHECKED' setelah halaman terbuka dan berhasil dimuat.",
            max_steps=3
        )

    def _generate_via_9router(self, prompt: str) -> str:
        """Fallback to 9Router when Google API is blocked"""
        import requests
        import os
        import time
        router_key = os.environ.get("NINEROUTER_KEY", "kiro-default-key")
        
        for attempt in range(5):
            try:
                resp = requests.post("http://localhost:20128/v1/chat/completions", json={
                    "model": "oc/deepseek-v4-flash-free",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.7
                }, headers={"Authorization": f"Bearer {router_key}"}, timeout=60)
                if resp.status_code == 200:
                    raw_body = resp.text
                    raw_body = raw_body.split("data: [DONE]")[0].strip()
                    import json
                    data = json.loads(raw_body)
                    return data["choices"][0]["message"]["content"]
                else:
                    self.logger.warning(f"9Router error (attempt {attempt+1}): {resp.text}")
                    if attempt < 4:
                        time.sleep(10)
            except Exception as e:
                self.logger.warning(f"Failed to connect to 9Router (attempt {attempt+1}): {e}")
                if attempt < 4:
                    time.sleep(10)
                    
        try:
            return self.llm.generate_content(prompt)
        except Exception as e:
            self.logger.error(f"Semua API Key habis/banned. Gagal menghasilkan konten: {e}")
            return ""

    def _fetch_rapid_financial_news(self) -> str:
        """Fetch real-time financial news from free RSS feeds."""
        import urllib.request
        import xml.etree.ElementTree as ET
        
        # Free Yahoo Finance top news feed
        url = "https://finance.yahoo.com/news/rssindex"
        self.logger.info("Mengambil berita kilat dari Yahoo Finance RSS...")
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=10) as response:
                xml_data = response.read()
                
            root = ET.fromstring(xml_data)
            news_items = []
            
            # Ambil 5 berita teratas
            for item in root.findall('.//item')[:5]:
                title = item.findtext('title', default='No Title')
                desc = item.findtext('description', default='No Description')
                pub_date = item.findtext('pubDate', default='No Date')
                news_items.append(f"Title: {title}\nDate: {pub_date}\nSummary: {desc}")
                
            if news_items:
                return "\n\n".join(news_items)
            return "Tidak ada berita ditemukan di feed."
        except Exception as e:
            self.logger.error(f"Gagal mengambil RSS feed: {e}")
            return f"Error fetching RSS: {e}"

    def post_content(self) -> None:
        if self.has_posted_news and not self.dry_run:
            return
            
        # Ensure we are logged in before attempting to post (unless in dry run mode)
        if not self.dry_run:
            if not self.login_linkedin():
                self.logger.error("Tidak dapat login ke LinkedIn. Abort posting.")
                return

        # Sebelum fetch berita, jalankan analitik
        self.analyze_post_performance()

        self.logger.info("Mencari berita kilat via RSS Feed secara real-time...")
        search_result = self._fetch_rapid_financial_news()
        
        if not search_result or "Error" in search_result or "Tidak ada berita" in search_result:
            self.logger.warning("Gagal mendapatkan berita kilat dari RSS.")
            return

        # 2. Baca dan verifikasi keakuratan berita dengan LLM
        self.logger.info("Menganalisis keakuratan berita...")
        from evan_fisher import EVAN_FISHER_PROMPT
        # Baca guidelines jika ada
        import os
        guidelines_path = os.path.join(os.path.dirname(__file__), "linkedin_writing_guidelines.txt")
        extra_guidelines = ""
        if os.path.exists(guidelines_path):
            with open(guidelines_path, "r", encoding="utf-8") as f:
                extra_guidelines = f.read().strip()
                
        guidelines_injection = f"\n\nADDITIONAL GUIDELINES BASED ON PAST PERFORMANCE:\n{extra_guidelines}\n" if extra_guidelines else ""

        verify_prompt = (
            "You are a world-class hybrid persona: You possess the brilliant macro-economic investment mind of Ray Dalio and Howard Marks, "
            "combined with the extreme persuasive storytelling and copywriting skills of Steve Jobs and Gary Halbert. "
            "Below are search results about current Global/US/Singapore investment markets:\n\n"
            f"{search_result}\n\n"
            "Your task: Pick ONE critical investment news/trend from the data, summarize it, and create a compelling, persuasive LinkedIn post.\n"
            "RULES:\n"
            "1. The post MUST start with the word 'Summary' (or a brief summary section) at the very top, in English.\n"
            "2. The post MUST be written ENTIRELY in English.\n"
            "3. Use advanced storytelling and extreme persuasive techniques to captivate high-net-worth individuals and top executives.\n"
            "4. Keep sentences short. One idea per line. Max 2 lines per paragraph. Lots of white space.\n"
            "5. Do NOT start with 'I' in the first sentence.\n"
            "6. Provide genuine, contrarian, or highly valuable insight regarding the investment news, thinking like a top hedge fund manager.\n"
            "7. At the END of the post, you MUST include a Promotional Call-To-Action (CTA). "
            "The CTA should pitch a Custom AI service. Specifically, offer to build them a 'Custom AI with the skill to receive rapid news and summarize it directly to them based on their exact custom specifications via email notifications'. You can also optionally offer an email newsletter subscription or a PDF promo. Make the CTA irresistible using your persuasive storytelling skills.\n"
            "8. Do NOT explicitly mention any copywriting frameworks or the names of these gurus (Ray Dalio, Gary Halbert, etc.) in your actual post. Just invisibly embody their genius style.\n"
            f"{guidelines_injection}\n"
            f"{EVAN_FISHER_PROMPT}\n\n"
            "Format your response EXACTLY like this:\n\n"
            "ANALYSIS:\n[Why this news is critical for investors right now]\n\n"
            "POST:\nSummary\n[The rest of the LinkedIn post content in English including the promotional CTA]"
        )
        
        llm_response = self._generate_via_9router(verify_prompt)
        if not llm_response or ("POST:" not in llm_response and "POSTINGAN:" not in llm_response):
            self.logger.error("Gagal memverifikasi dan membuat postingan.")
            return
            
        # Support both English and Indonesian format labels
        pitch = ""
        if "POST:" in llm_response:
            pitch = llm_response.split("POST:")[1].strip()
        else:
            pitch = llm_response.split("POSTINGAN:")[1].strip()
            
        self.logger.info("Validasi Internal Draf (Self-Correction)...")
        # --- Autonomous Validation Loop ---
        max_retries = 2
        for attempt in range(max_retries):
            validation_prompt = (
                "You are an expert QA copyeditor. Your job is to strictly enforce the Evan Fisher constraints and the new formatting rules.\n"
                f"Review the following draft:\n\n{pitch}\n\n"
                "CHECKLIST:\n"
                "- Does the post start with 'Summary' or contain a clear summary section at the top?\n"
                "- Is there a clear Promotional CTA at the bottom (email newsletter, custom AI bot, or PDF)?\n"
                "- Are there any paragraphs with more than 2 lines? (Must be short lines).\n"
                "- Does it start with 'I' in the first sentence?\n"
                "- Are there banned buzzwords like 'leverage', 'synergy', 'revolutionary', 'innovative', 'cutting-edge'?\n"
                "- Is the text strictly UNDER 3000 characters total?\n"
                "If it perfectly follows Evan Fisher's style, includes the Summary, and the CTA, reply EXACTLY with: 'PASS'.\n"
                "If it fails, reply with 'FAIL:' followed by the reason AND the revised draft starting with 'REVISION:'."
            )
            val_resp = self._generate_via_9router(validation_prompt)
            if val_resp and val_resp.strip().startswith("PASS"):
                self.logger.info(f"[VALIDATION PASS] Draft lolos pengecekan.")
                break
            elif val_resp and "REVISION:" in val_resp:
                self.logger.warning(f"[VALIDATION FAIL] Memperbaiki draf... (Attempt {attempt+1})")
                pitch = val_resp.split("REVISION:")[1].strip()
            else:
                self.logger.warning(f"[VALIDATION WARNING] LLM QA gagal merespons dengan format benar. Melanjutkan dengan draf saat ini.")
                break

        self.logger.info(f"Draft konten final siap diposting.")

        self.logger.info("[POST] Memulai Playwright script untuk memposting berita...")
        async def playwright_post(page, context):
            try:
                import random
                import asyncio
                
                if self.dry_run:
                    self.logger.info("[DRY RUN] Mode uji coba aktif. Tidak akan memposting ke LinkedIn.")
                    msg = f"🚀 [DRY RUN - LinkedIn Post]\n\n{pitch}"
                    if self.hermes:
                        self.hermes.send_message(msg)
                    else:
                        self.logger.info(msg)
                    
                    self.has_posted_news = True
                    return "DRY_RUN_POST_SUCCESS"

                # Jitter before interacting
                await asyncio.sleep(random.uniform(5.0, 15.0))
                
                # Buka homepage (feed) untuk klik tombol Start a post
                await page.goto("https://www.linkedin.com/feed/", timeout=20000)
                await __import__('asyncio').sleep(5)
                
                # Scroll down sedikit untuk men-trigger UI loading
                await page.evaluate("window.scrollBy(0, 200)")
                await __import__('asyncio').sleep(2)
                
                # Cari tombol di feed menggunakan locator teks langsung
                try:
                    start_post_btn = page.locator("text=Start a post, text=Buat postingan, text=Mulai postingan, text=Create a post, button.share-box-feed-entry__trigger").first
                    await start_post_btn.click(timeout=5000, force=True)
                except Exception:
                    self.logger.warning("Gagal menemukan tombol Start a post dengan locator. Menggunakan evaluasi JS Fallback (Trusted Click)...")
                    btn_handle = await page.evaluate_handle('''() => {
                        let elements = Array.from(document.querySelectorAll('button, a, span, div, p'));
                        let btn = elements.find(el => {
                            let t = el.innerText ? el.innerText.trim().toLowerCase() : '';
                            return t === 'start a post' || t === 'create a post' || t === 'buat postingan' || t === 'mulai buat postingan' || t === 'mulai postingan';
                        });
                        return btn;
                    }''')
                    if btn_handle:
                        await btn_handle.click(force=True)
                        self.logger.info("✅ Berhasil mengklik tombol menggunakan JS Fallback (Trusted Click)!")
                    else:
                        self.logger.error("Gagal menemukan tombol post di Feed secara absolut.")
                        return "FAILED_NO_BTN_IN_PROFILE"
                
                await __import__('asyncio').sleep(2)
            except Exception as e:
                self.logger.debug(f"Error navigating to LinkedIn profile: {e}")
                
            # Wait for the post modal/editor to appear
            try:
                editor = await page.wait_for_selector(".ql-editor, div[role='textbox'], [contenteditable='true']", timeout=15000)
            except Exception as e:
                self.logger.error(f"Editor not found: {e}")
                return "FAILED_EDITOR"
            
            # Clean up the text content
            teks = pitch.replace('\\"', '"').replace('\\n', '\n')
            
            await editor.click()
            await page.keyboard.insert_text(teks)
            await __import__('asyncio').sleep(2)
            
            # 4. Klik tombol Post
            post_btn = await page.query_selector("button.share-actions__primary-action, button.artdeco-button--primary:has-text('Post'), button.artdeco-button--primary:has-text('Posting')")
            if not post_btn:
                # Coba fallback
                post_btn = await page.query_selector("div.share-box_actions button.artdeco-button--primary")
                
            if not post_btn:
                self.logger.error("Tombol Post tidak ditemukan.")
                return "FAILED_POST_BTN"
            
            # Coba fallback click JS agar tahan banting
            try:
                await post_btn.click(force=True, timeout=5000)
            except Exception as e:
                self.logger.debug(f"Fallback click failed: {e}")
                await page.evaluate("(el) => el.click()", post_btn)
            
            await __import__('asyncio').sleep(5)
            return "POST_SUCCESS"
        
        result = self.browser.execute_playwright_script(playwright_post)
        self.logger.info(f"[POST] Hasil eksekusi Playwright: {result}")

        if "POST_SUCCESS" in result:
            self.has_posted_news = True
            self.replied_memory["last_posted_date"] = self.today_str
            import json
            import os
            from config import SYSTEM_DIR
            mem_path = os.path.join(SYSTEM_DIR, "linkedin_memory.json")
            try:
                with open(mem_path, "w", encoding="utf-8") as f:
                    json.dump(self.replied_memory, f, indent=4)
            except Exception as e:
                self.logger.error(f"Gagal menyimpan linkedin_memory.json: {e}")

    def monitor_inbox_and_reply(self) -> int:
        self.logger.info("Memeriksa pesan (Inbox) LinkedIn...")
        replied_count = 0
        if not self._is_logged_in():
            self.logger.error("LinkedIn belum login. Lewati pengecekan Inbox.")
            return 0
            
        url = "https://www.linkedin.com/messaging/"
        self.logger.info(f"Navigasi ke Inbox LinkedIn: {url}")
        
        async def navigate_to_inbox(page, context):
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            import asyncio
            await asyncio.sleep(5) # Tunggu Inbox termuat
            return "INBOX_LOADED"
            
        nav_result = self.browser.execute_playwright_script(navigate_to_inbox)
        if "FAILED" in nav_result:
            self.logger.error(f"Gagal navigasi ke Inbox LinkedIn: {nav_result}")
            return 0

        prompt_inbox = (
            f"Buka {url} secara langsung. "
            "Ini adalah halaman Messaging LinkedIn. Cek daftar chat di panel kiri. "
            "Cari chat yang memiliki indikator unread (belum dibaca) ATAU dari rekruter/klien yang baru mengirim pesan. "
            "Jika ada pesan baru, klik chat tersebut. Baca pesannya. "
            "Jika pesan menunjukkan ketertarikan, tawaran interview, atau pertanyaan seputar profil kita (data/scraping/python/F&B marketing), "
            "salin nama pengirim dan isi pesan terakhir mereka. "
            "Gunakan aksi 'done' dengan result JSON: {'prospect_name': '...', 'last_message': '...', 'intent': 'interested'}. "
            "Jika mereka menolak atau pesannya spam/promosi, gunakan 'intent': 'rejected'. "
            "Jika TIDAK ADA pesan baru yang perlu dibalas (misalnya pesan terakhir adalah dari kamu atau tidak ada chat ber-highlight bold), langsung gunakan aksi 'done' dengan result 'NO_NEW_MESSAGES'.\n"
        )

        result = self.browser.execute_task(prompt_inbox, max_steps=10)
        
        if isinstance(result, str) and "NO_NEW_MESSAGES" in result:
            self.logger.info("Tidak ada pesan masuk baru di LinkedIn yang perlu dibalas.")
            return 0
            
        try:
            import json
            import time
            import string
            
            data = {}
            if isinstance(result, dict):
                data = result
            elif isinstance(result, str):
                start = result.find('{')
                end = result.rfind('}') + 1
                if start >= 0 and end > start:
                    data = json.loads(result[start:end])
            
            prospect_name = data.get("prospect_name")
            last_message = data.get("last_message")
            intent = data.get("intent")
            
            if prospect_name and last_message and intent == "interested":
                current_time = time.time()
                
                # Lapis 1: Cek 12-Hour Cooldown (Pencegahan Spam Utama)
                last_reply_time = self.replied_memory.get(f"{prospect_name}_time", 0)
                if current_time - last_reply_time < 12 * 3600:
                    self.logger.info(f"Sudah membalas @{prospect_name} dalam 12 jam terakhir. Skip agar tidak spam.")
                    return 0

                # Lapis 2: Normalisasi teks untuk menghindari bug OCR layar visual
                def _norm(t): return str(t).translate(str.maketrans('', '', string.punctuation)).lower().strip() if t else ""
                if _norm(self.replied_memory.get(prospect_name)) == _norm(last_message):
                    self.logger.info(f"Pesan ini sudah dibalas sebelumnya (@{prospect_name}). Skip agar tidak spam.")
                    return 0

                self.logger.info(f"Ditemukan pesan dari @{prospect_name}: {last_message}")
                
                # Generate PDF audit secara dinamis
                pdf_path = None
                try:
                    import os
                    from report_generator import generate_linkedin_audit_data, create_linkedin_audit_pdf
                    company_name = "Independent" # Default company name
                    audit_data = generate_linkedin_audit_data(self.llm, prospect_name, company_name, last_message)
                    
                    pdf_filename = f"audit_{prospect_name.replace(' ', '_')}.pdf"
                    pdf_path = os.path.abspath(pdf_filename)
                    create_linkedin_audit_pdf(prospect_name, company_name, audit_data, pdf_path)
                    self.logger.info(f"PDF audit LinkedIn berhasil dibuat: {pdf_path}")
                except Exception as audit_err:
                    self.logger.error(f"Gagal men-generate PDF audit LinkedIn: {audit_err}")

                # Generate balasan pakai LLM
                from evan_fisher import EVAN_FISHER_PROMPT
                reply_prompt = (
                    f"You are Verdiawan Raafi, a professional Python Automation & Web Scraping expert.\n"
                    f"A LinkedIn contact '@{prospect_name}' sent this message: \"{last_message}\"\n\n"
                    f"TASK: Write a professional reply message to accompany a technical audit report PDF we just attached.\n\n"
                    f"CRITICAL LANGUAGE RULE:\n"
                    f"- Detect the language of the incoming message above.\n"
                    f"- If the message is in English, reply in English.\n"
                    f"- If the message is in Indonesian, reply in Indonesian.\n"
                    f"- NEVER reply in a different language than what the sender used.\n\n"
                    f"TONE & STYLE RULES:\n"
                    f"- Be professional, warm, and genuinely helpful.\n"
                    f"- Explicitly mention that you have attached a customized Technical Audit Report PDF specifically for their case.\n"
                    f"- Suggest a brief 10-minute technical alignment call if they want to move forward.\n"
                    f"- Keep it conversational and concise (max 70 words).\n"
                    f"- Output ONLY the reply message text, nothing else.\n\n"
                    f"{EVAN_FISHER_PROMPT}"
                )
                
                ai_reply = self.llm.generate_content(reply_prompt)
                
                if ai_reply:
                    self.logger.info(f"Mengirim balasan ke @{prospect_name} via Playwright: {ai_reply}")
                    
                    async def playwright_reply(page, context):
                        try:
                            # 1. Upload PDF jika ada
                            if pdf_path and os.path.exists(pdf_path):
                                file_input = await page.wait_for_selector("input[type='file']", timeout=10000)
                                if file_input:
                                    await file_input.set_input_files(pdf_path)
                                    await __import__('asyncio').sleep(5) # Tunggu upload selesai
                                else:
                                    self.logger.warning("Input file tidak ditemukan di LinkedIn DM.")

                            # 2. Cari area textbox pesan di LinkedIn (Message form)
                            textbox = await page.wait_for_selector("div.msg-form__contenteditable", timeout=10000)
                            if not textbox:
                                return "REPLY_FAILED_NO_TEXTBOX"
                                
                            await textbox.click(timeout=5000)
                            teks = ai_reply.replace('\\"', '"').replace('\\n', '\n')
                            await page.keyboard.type(teks, delay=10)
                            await __import__('asyncio').sleep(2)
                            
                            # Klik tombol Send (Kirim)
                            send_btn = await page.query_selector("button.msg-form__send-button")
                            if send_btn:
                                await send_btn.click(force=True)
                            else:
                                await page.keyboard.press("Enter")
                            
                            await __import__('asyncio').sleep(3)
                            return "REPLY_SENT"
                        except Exception as e:
                            self.logger.error(f"Error Playwright Reply LinkedIn: {e}")
                            return "REPLY_ERROR"

                    send_res = self.browser.execute_playwright_script(playwright_reply)
                    if isinstance(send_res, str) and "REPLY_SENT" in send_res:
                        self.logger.info(f"✅ Balasan LinkedIn sukses dikirim ke @{prospect_name}!")
                        self.replied_memory[prospect_name] = last_message
                        self.replied_memory[f"{prospect_name}_time"] = time.time()
                        _save_linkedin_memory(self.replied_memory)
                        replied_count += 1
                        # Bersihkan file PDF setelah sukses dikirim
                        if pdf_path and os.path.exists(pdf_path):
                            try:
                                os.remove(pdf_path)
                            except Exception as rm_err:
                                self.logger.warning(f"Gagal menghapus file temporer {pdf_path}: {rm_err}")
                    else:
                        self.logger.warning(f"⚠️ Status balasan tidak jelas: {send_res}")
            
            elif intent == "rejected":
                self.logger.info(f"Pesan dari @{prospect_name} diabaikan (rejected).")
                
        except Exception as e:
            self.logger.error(f"Gagal memparsing atau membalas pesan Inbox LinkedIn: {e}")
            
        return replied_count
