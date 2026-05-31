import asyncio
import logging
import os
import sys
import time
from playwright.async_api import Page, Locator
from dotenv import load_dotenv

# Tambahkan path ke directory utama
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from api_client import GeminiClient
from sandbox_tester import SandboxTester
from financial_tracker import FinancialTracker
from hermes_agent import HermesAgent

load_dotenv()
logger = logging.getLogger("HyrveAgent")

class HyrveAgent:
    def __init__(self, browser_agent, llm_client):
        self.browser = browser_agent
        self.llm = llm_client
        self.finance = FinancialTracker()
        self.sandbox = SandboxTester(duration_minutes=5, llm_client=self.llm)
        self.hermes = HermesAgent(gemini_client=self.llm)
        self.is_logged_in = False
        
    def login_hyrve(self) -> bool:
        """
        Melakukan login visual ke Hyrve AI secara otonom via browser siluman.
        Jika sesi persistent chrome_data sudah aktif, ia akan langsung masuk.
        Jika butuh login, ia akan mengeklik demo 'Agent Owner' untuk login instan.
        """
        logger.info("[Hyrve] Memulai alur login Hyrve AI...")
        
        # Helper fungsi internal untuk dieksekusi di dalam context BrowserAgent (Playwright)
        async def _login_logic(page: Page) -> bool:
            try:
                logger.info("[Hyrve] Navigasi ke https://app.hyrveai.com/login...")
                await page.goto("https://app.hyrveai.com/login", wait_until="networkidle", timeout=60000)
                await asyncio.sleep(4)
                
                # Cek jika sudah auto-redirect ke dashboard (persistent session aktif)
                if "login" not in page.url:
                    logger.info("[Hyrve] ✅ Sesi persistent aktif! Auto-login sukses.")
                    self.is_logged_in = True
                    return True
                
                # Coba login demo 'Agent Owner'
                logger.info("[Hyrve] Mencari tombol login demo 'Agent Owner'...")
                agent_owner_btn = page.locator("div:has-text('Agent Owner'), button:has-text('Agent Owner')").last
                
                if await agent_owner_btn.is_visible():
                    box = await agent_owner_btn.bounding_box()
                    if box:
                        logger.info("[Hyrve] Klik tombol demo Agent Owner secara visual...")
                        await page.mouse.click(box['x'] + box['width']/2, box['y'] + box['height']/2)
                        await asyncio.sleep(8)
                        
                        if "dashboard" in page.url or "jobs" in page.url:
                            logger.info("[Hyrve] ✅ Login demo Agent Owner sukses!")
                            self.is_logged_in = True
                            await page.screenshot(path="output/hyrve_demo_login_success.png")
                            return True
                
                logger.warning("[Hyrve] ⚠️ Tombol demo tidak terdeteksi atau redirect gagal.")
                await page.screenshot(path="output/hyrve_login_failed.png")
                return False
                
            except Exception as e:
                logger.error(f"[Hyrve] Error saat login: {e}")
                return False

        # Daftarkan aksi ke BrowserAgent
        success = self.browser.run_action(_login_logic)
        return success if success else False

    def search_and_execute_missions(self) -> int:
        """
        Menelusuri marketplace Hyrve AI untuk mencari misi coding aktif,
        menghasilkan solusinya secara otonom, melakukan validasi sandbox,
        dan men-submit kodenya secara visual di halaman web!
        Returns: Jumlah task yang sukses diselesaikan.
        """
        if not self.is_logged_in:
            logger.warning("[Hyrve] Belum login. Skip pencarian misi.")
            return 0
            
        logger.info("[Hyrve] Memulai pencarian dan eksekusi misi di marketplace...")
        
        async def _mission_logic(page: Page) -> int:
            completed_count = 0
            try:
                # Navigasi ke halaman jobs
                logger.info("[Hyrve] Menuju halaman https://app.hyrveai.com/jobs...")
                await page.goto("https://app.hyrveai.com/jobs", wait_until="networkidle", timeout=60000)
                await asyncio.sleep(5)
                await page.screenshot(path="output/hyrve_jobs_marketplace.png")
                
                # Cari link/tombol view job
                job_selectors = [
                    "a[href*='/jobs/']", 
                    "button:has-text('View')", 
                    "button:has-text('Apply')",
                    ".job-card"
                ]
                
                job_btn = None
                for sel in job_selectors:
                    locator = page.locator(sel).first
                    if await locator.is_visible():
                        job_btn = locator
                        break
                        
                if not job_btn:
                    logger.info("[Hyrve] Keren! Tidak ada misi baru yang tersedia saat ini.")
                    return 0
                    
                # Klik ke detail misi
                logger.info("[Hyrve] Membuka detail misi pertama...")
                await job_btn.click()
                await asyncio.sleep(5)
                await page.screenshot(path="output/hyrve_job_details.png")
                
                # Ekstrak data requirements tugas
                title = "Autonomous Web Automation Script"
                description = "Build a robust Python script to automate a form submission or process data from Wikipedia tables. Implement full logging and solid exception handling."
                budget = 75.0
                
                try:
                    title_el = await page.locator("h1, h2.job-title").first.text_content()
                    if title_el:
                        title = title_el.strip()
                    desc_el = await page.locator(".job-description, .mission-description, p").first.text_content()
                    if desc_el:
                        description = desc_el.strip()
                except Exception as ex:
                    logger.warning(f"[Hyrve] Gagal parsing detail DOM: {ex}. Menggunakan default mock.")
                
                logger.info(f"[Hyrve] Misi Aktif: {title}")
                
                # Kirim sinyal Telegram
                self.hermes.send_message(
                    f"🤖 *Hyrve AI Otonom — Job Active*\n\n"
                    f"📌 Judul: *{title}*\n"
                    f"💰 Budget: `${budget:.2f}`\n"
                    f"⚙️ Memulai pengerjaan kode & sandbox testing...",
                    markdown=True
                )
                
                # 1. GENERATE SOLUSI KODE VIA GEMMA-31B
                prompt = (
                    f"Tulis script Python 3.10+ yang lengkap, aman, dan siap pakai untuk tugas berikut:\n\n"
                    f"Judul: {title}\n"
                    f"Deskripsi: {description}\n\n"
                    f"Requirements Wajib:\n"
                    f"- Gunakan modul logging untuk pelaporan aktivitas.\n"
                    f"- Terapkan try-except block yang menyeluruh di setiap network I/O.\n"
                    f"- Wajib sertakan docstring di setiap fungsi.\n\n"
                    f"Kembalikan HANYA kode Python murni tanpa penanda markdown ```python atau penjelasan lainnya."
                )
                
                llm_code = self.llm.generate_content(prompt, use_codegen_model=True)
                if not llm_code:
                    raise Exception("LLM generation gagal.")
                    
                if "```python" in llm_code:
                    llm_code = llm_code.split("```python")[1].split("```")[0]
                elif "```" in llm_code:
                    llm_code = llm_code.split("```")[1]
                
                import textwrap
                llm_code = textwrap.dedent(llm_code).strip()
                
                # Simpan draft kode
                timestamp = time.strftime("%Y%m%d_%H%M%S")
                os.makedirs("output/generated", exist_ok=True)
                code_path = f"output/generated/hyrve_{timestamp}.py"
                with open(code_path, "w", encoding="utf-8") as f:
                    f.write(llm_code)
                    
                # 2. RUN SANDBOX VALIDATION WITH 7X AUTO-FIX
                logger.info(f"[Hyrve] Mengirim {code_path} ke SandboxTester...")
                sandbox_passed = self.sandbox.test_code(code_path)
                
                if sandbox_passed:
                    logger.info("[Hyrve] ✅ Sandbox PASSED! Memulai delivery otonom...")
                    
                    with open(code_path, "r", encoding="utf-8") as f:
                        final_code = f.read()
                        
                    # Catat ke Tracker Keuangan
                    self.finance.log_proposal("hyrve", title, expected_revenue=budget)
                    self.finance.update_job_status(title, "DELIVERED", budget)
                    
                    self.hermes.send_message(
                        f"✅ *Hyrve AI — Sandbox Passed!*\n\n"
                        f"🎉 Solusi untuk *{title}* sukses divalidasi sandbox!\n"
                        f"💾 Path: `{code_path}`\n"
                        f"🚀 Mengunggah solusi ke dashboard secara visual...",
                        markdown=True
                    )
                    
                    # 3. SUBMIT SOLUSI SECARA VISUAL
                    submit_btn = page.locator("button:has-text('Submit Solution'), button:has-text('Deliver'), button:has-text('Complete')").first
                    if await submit_btn.is_visible():
                        await submit_btn.click()
                        await asyncio.sleep(3)
                        
                        text_area = page.locator("textarea, .solution-input").first
                        if await text_area.is_visible():
                            await text_area.fill(final_code)
                            await asyncio.sleep(2)
                            
                        confirm_btn = page.locator("button:has-text('Confirm'), button:has-text('Submit Code')").first
                        await confirm_btn.click()
                        await asyncio.sleep(6)
                        
                        logger.info("[Hyrve] ✅ Delivery sukses disubmit!")
                        await page.screenshot(path="output/hyrve_submit_success.png")
                        
                        self.hermes.send_message(
                            f"🚀 *Hyrve AI — Deliver Sukses!*\n\n"
                            f"✨ Solusi kode berhasil disubmit secara visual di dashboard Hyrve AI!",
                            markdown=True
                        )
                        completed_count = 1
                    else:
                        logger.warning("[Hyrve] Tombol submit solution tidak terlihat di DOM.")
                else:
                    logger.warning("[Hyrve] ❌ Sandbox FAILED. Solusi tidak di-submit.")
                    self.hermes.send_message(
                        f"⚠️ *Hyrve AI — Sandbox Failed*\n\n"
                        f"❌ Misi *{title}* gagal validasi sandbox setelah 7x auto-fix.",
                        markdown=True
                    )
                    
            except Exception as e:
                logger.error(f"[Hyrve] Error memproses misi: {e}")
                
            return completed_count

        result = self.browser.run_action(_mission_logic)
        return result if result else 0
