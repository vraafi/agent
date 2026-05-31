import asyncio
import time
from playwright.async_api import async_playwright

async def run_direct_survey():
    print("="*60)
    print("🚀 MEMULAI OTOMATISASI SURVEI LANGSUNG (CDP PLAYWRIGHT)")
    print("="*60)
    
    opini = "Menurut saya, pekerja kantoran terhebat adalah mereka yang memiliki filosofi 'Menjadi Solusi, Bukan Beban'. Mereka mampu mengatasi masalah secara mandiri tanpa menciptakan drama, memiliki integritas tinggi, dan rasa kepemilikan yang kuat."
    skill = "Kombinasi antara hard skills seperti analisis data dan penguasaan teknologi, dengan soft skills seperti critical thinking, komunikasi empatik, adaptabilitas, dan manajemen waktu yang berfokus pada skala prioritas (Eisenhower Matrix)."
    
    async with async_playwright() as p:
        try:
            print("[+] Menghubungkan ke Cloak Browser (port 9222)...")
            browser = await p.chromium.connect_over_cdp("http://127.0.0.1:9222")
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = context.pages[0] if context.pages else await context.new_page()
            
            print(f"[+] Terhubung! URL saat ini: {page.url}")
            print("[+] Memulai siklus pengisian form survei. Menunggu elemen...")
            
            # Tunggu loading sebentar
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=10000)
            except Exception:
                pass
                
            max_attempts = 15
            for attempt in range(max_attempts):
                print(f"--- Usaha {attempt+1}/{max_attempts} ---")
                try:
                    inputs = await page.query_selector_all("textarea, input[type='text']")
                    if inputs:
                        print(f"[*] Menemukan {len(inputs)} kotak teks. Mengisi data...")
                        for idx, el in enumerate(inputs):
                            teks_isi = opini if idx == 0 else skill
                            try:
                                await el.fill(teks_isi)
                                print(f"  -> Berhasil mengisi kotak ke-{idx+1}")
                            except Exception as e:
                                print(f"  -> Gagal mengisi: {e}")
                                
                        buttons = await page.query_selector_all("button, input[type='submit'], a.btn, [role='button']")
                        lanjut_btn = None
                        for b in buttons:
                            teks_btn = await b.inner_text()
                            if teks_btn and any(kata in teks_btn.lower() for kata in ["lanjut", "next", "submit", "kirim", "selesai", "mulai"]):
                                lanjut_btn = b
                                break
                        
                        if lanjut_btn:
                            print(f"[*] Menemukan tombol: '{await lanjut_btn.inner_text()}'. Mengeklik...")
                            await lanjut_btn.click()
                            await page.wait_for_timeout(3000)
                        else:
                            print("[-] Tombol Lanjut/Submit tidak ditemukan. Menunggu intervensi manual...")
                            
                    else:
                        print("[-] Tidak menemukan kotak input. Mungkin berada dalam Iframe atau halaman sedang loading.")
                        frames = page.frames
                        if len(frames) > 1:
                            print(f"[*] Terdeteksi {len(frames)} Iframe. Mencoba masuk ke dalam iframe...")
                            for f in frames[1:]:
                                try:
                                    f_inputs = await f.query_selector_all("textarea, input[type='text']")
                                    if f_inputs:
                                        print(f"  -> Menemukan {len(f_inputs)} kotak di dalam iframe.")
                                        for idx, el in enumerate(f_inputs):
                                            await el.fill(opini if idx == 0 else skill)
                                            print(f"  -> Berhasil mengisi kotak iframe ke-{idx+1}")
                                        f_buttons = await f.query_selector_all("button, input[type='submit']")
                                        for b in f_buttons:
                                            t = await b.inner_text()
                                            if t and any(kata in t.lower() for kata in ["lanjut", "next", "submit"]):
                                                await b.click()
                                                print("  -> Tombol lanjut iframe diklik!")
                                                break
                                except:
                                    pass
                except Exception as loop_e:
                    print(f"[-] Terjadi navigasi atau error DOM saat memindai: {loop_e}")
                    
                await page.wait_for_timeout(5000) # Tunggu 5 detik
                
            print("\n[!] Siklus otomatis selesai. Browser dibiarkan TERBUKA sesuai instruksi.")
            
        except Exception as e:
            print(f"\n❌ Gagal terhubung atau error: {e}")
            print("[!] BROWSER TIDAK AKAN DITUTUP. Silakan periksa manual.")

if __name__ == "__main__":
    asyncio.run(run_direct_survey())
