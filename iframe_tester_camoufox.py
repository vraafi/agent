import asyncio
import time
from browser_agent import BrowserAgent

def run_experiment():
    print("="*60)
    print("🤖 ANTIGRAVITY MENGAMBIL ALIH EKSKUSI")
    print("="*60)
    print("[Memulai Cloak Browser (Camoufox)...]")
    
    try:
        # Kita panggil BrowserAgent dengan Camoufox agar tidak perlu port 9222 eksternal
        with BrowserAgent(headless=False, use_camoufox=True) as browser:
            print("\n[1] Menavigasi ke MetroOpinion...")
            browser.navigate("https://member.metroopinion.com/login")
            
            print("\n" + "!"*50)
            print("⚠️ BANTU SAYA LOGIN")
            print("!"*50)
            print("Karena saya membuka browser baru, saya tidak memiliki cookie login Anda.")
            print("1. Silakan login secara manual.")
            print("2. Masuk ke halaman survei yang ada form/klik-nya.")
            input("\n>>> JIKA SURVEI SUDAH TERBUKA, TEKAN [ENTER] DI SINI <<< ")
            
            print("\n[2] Memulai Pemindaian Iframe Super Tajam...")
            
            # Karena BrowserAgent menyembunyikan objek 'page', kita akses dari belakang layar
            page = browser._camoufox_instance.page if hasattr(browser, '_camoufox_instance') else None
            
            if not page:
                print("❌ Gagal mendapatkan akses langsung ke objek halaman.")
                return
                
            # Kita jalankan coroutine playwright di dalam event loop sinkron
            async def scan_iframes(p):
                frames = p.frames
                print(f"\n📊 Ditemukan {len(frames)} frame(s) di halaman ini.")
                
                total_found = 0
                for idx, frame in enumerate(frames):
                    frame_type = "MAIN PAGE" if idx == 0 else "IFRAME"
                    print(f"\n--- Memindai {frame_type} {idx} (URL: {frame.url[:60]}...) ---")
                    try:
                        elements = await frame.query_selector_all("a, button, input, textarea, select, [role='button'], [role='checkbox'], [role='radio']")
                        found_in_frame = 0
                        for el in elements:
                            if await el.is_visible():
                                tag = await el.evaluate("el => el.tagName.toLowerCase()")
                                text = (await el.inner_text()).strip()[:40]
                                el_type = await el.get_attribute("type") or ""
                                label = text or el_type or tag
                                print(f"   [Elemen] <{tag}> {label.replace(chr(10), ' ')}")
                                found_in_frame += 1
                                total_found += 1
                        if found_in_frame == 0:
                            print("   (Tidak ada elemen interaktif)")
                    except Exception as e:
                        print(f"   (Frame terkunci)")
                return total_found

            # Gunakan hack kecil untuk menjalankan coroutine di event loop playwright yang sedang berjalan
            import nest_asyncio
            nest_asyncio.apply()
            
            total = asyncio.run(scan_iframes(page))
            
            print("\n" + "="*60)
            if total > 0:
                print(f"✅ SAYA BERHASIL! Menemukan {total} elemen tersembunyi di dalam Iframe.")
                print("Eksperimen membuktikan teori saya benar. Kita bisa mengajari Hermes!")
            else:
                print("❌ Gagal menemukan elemen.")
                
            input("\nTekan ENTER untuk menutup browser eksperimen ini...")
            
    except Exception as e:
        print(f"\n❌ Terjadi kesalahan: {e}")

if __name__ == "__main__":
    run_experiment()
