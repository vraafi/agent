import asyncio
import logging
from browser_agent import BrowserAgent
from playwright.async_api import async_playwright
import os

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_ui")

async def test_ui_only():
    try:
        # Start browser using the same logic as the agent
        agent = BrowserAgent()
        brave_path = None
        for p in [os.path.join(os.getcwd(), "bin", "cloak", "cloakbrowser.exe")]:
            if os.path.exists(p):
                brave_path = p
                break
        
        import subprocess
        flags = [
            "--remote-debugging-port=9222",
            "--remote-debugging-address=0.0.0.0",
            "--no-first-run",
            "--no-default-browser-check",
            "--user-data-dir=" + os.path.join(os.getcwd(), "bin", "cloak_profile")
        ]
        proc = subprocess.Popen([brave_path] + flags)
        await asyncio.sleep(3)
        
        async with async_playwright() as p:
            logger.info("Menyambungkan ke Cloak Browser via CDP...")
            browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
            context = browser.contexts[0]
            page = await context.new_page()
            
            logger.info("Menuju ke halaman Feed...")
            await page.goto("https://www.linkedin.com/feed/", timeout=20000)
            await asyncio.sleep(5)
            
            # Scroll sedikit
            await page.evaluate("window.scrollBy(0, 200)")
            await asyncio.sleep(2)
            
            logger.info("Mencari tombol Start a post...")
            try:
                start_post_btn = page.locator("text=Start a post, text=Buat postingan, text=Mulai postingan, text=Create a post, button.share-box-feed-entry__trigger").first
                await start_post_btn.click(timeout=5000, force=True)
                logger.info("\u2705 Berhasil mengklik tombol!")
            except Exception as e:
                logger.warning("Gagal menemukan tombol Start a post dengan locator. Menggunakan evaluasi JS fallback...")
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
                    logger.info("\u2705 Berhasil mengklik tombol menggunakan JS Fallback (Trusted Click)!")
                else:
                    logger.error("Gagal menemukan tombol post di Feed secara absolut.")
                    return
            
            await asyncio.sleep(5)
            logger.info("Taking screenshot to see if modal opened...")
            await page.screenshot(path="modal_debug.png", full_page=True)
            logger.info("Screenshot saved as modal_debug.png")
            
            # Wait for modal
            editor = page.locator(".ql-editor, div[role='textbox'], [contenteditable='true']").first
            await editor.wait_for(state="visible", timeout=15000)
            
            logger.info("Menempelkan teks draf ke editor...")
            await editor.click()
            await page.keyboard.type("Halo LinkedIn! Ini adalah tes dari AI VTuber Kara. (Tidak perlu dipost, ini hanya tes UI saja).")
            
            logger.info("SELESAI! Silakan lihat browser Anda. Script akan menutup dalam 10 detik.")
            await asyncio.sleep(10)
            
            await page.close()
            await browser.close()
            
        proc.terminate()
        
    except Exception as e:
        logger.error(f"Error: {e}")

if __name__ == "__main__":
    asyncio.run(test_ui_only())
