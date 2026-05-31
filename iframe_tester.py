import asyncio
import os
from playwright.async_api import async_playwright

async def run_experiment():
    print("="*60)
    print("🔍 EKSPERIMEN: DEEP IFRAME PENETRATION")
    print("="*60)
    
    # URL default untuk koneksi browser lokal Hermes
    cdp_url = os.environ.get("BRAVE_CDP_URL", "http://127.0.0.1:9222")
    
    async with async_playwright() as pw:
        try:
            print(f"[Menghubungkan ke browser di {cdp_url}...]")
            browser = await pw.chromium.connect_over_cdp(cdp_url)
            
            # Ambil konteks dan halaman aktif
            context = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = context.pages[0] if context.pages else await context.new_page()
            
            print(f"✅ Berhasil terhubung! Halaman aktif saat ini:")
            print(f"   URL: {page.url}")
            
            # Tunggu sebentar agar semua iframe (yang mungkin loading lambat) selesai dimuat
            print("\n[Menunggu Iframe pihak ketiga dimuat...]")
            await page.wait_for_timeout(4000)
            
            frames = page.frames
            print(f"📊 Ditemukan total {len(frames)} frame(s) di halaman ini (1 Main Frame + {len(frames)-1} Iframes).")
            
            global_elements = []
            
            for idx, frame in enumerate(frames):
                frame_type = "MAIN PAGE" if idx == 0 else "IFRAME"
                print(f"\n--- Memindai {frame_type} {idx} (URL: {frame.url[:60]}...) ---")
                try:
                    # Ambil elemen interaktif krusial (termasuk radio button dan checkbox untuk survei)
                    elements = await frame.query_selector_all("a, button, input, textarea, select, [role='button'], [role='checkbox'], [role='radio']")
                    
                    found_in_frame = 0
                    for el in elements:
                        # Kita hanya peduli pada elemen yang benar-benar bisa dilihat dan diklik user
                        if await el.is_visible():
                            tag = await el.evaluate("el => el.tagName.toLowerCase()")
                            text = (await el.inner_text()).strip()[:40]
                            el_type = await el.get_attribute("type") or ""
                            placeholder = await el.get_attribute("placeholder") or ""
                            
                            # Coba cari aria-label jika teks kosong
                            aria_label = await el.get_attribute("aria-label") or ""
                            
                            label = text or placeholder or aria_label or el_type or tag
                            
                            # Hilangkan karakter newline agar rapi
                            label = label.replace("\n", " ")
                            
                            global_elements.append(el)
                            global_idx = len(global_elements) - 1
                            print(f"   [{global_idx}] <{tag}> {label}")
                            found_in_frame += 1
                            
                    if found_in_frame == 0:
                        print("   (Tidak ada elemen interaktif yang terlihat)")
                except Exception as e:
                    print(f"   (Frame terkunci karena perlindungan keamanan lintas domain / CORS)")
                    
            print("\n" + "="*60)
            if global_elements:
                print(f"✅ SUKSES BESAR! Total {len(global_elements)} elemen ditemukan lintas-iframe.")
                print("Jika tombol atau form survei yang Anda maksud ada di daftar atas,")
                print("berarti kita sudah bisa mengajari Hermes Agent untuk mengekliknya secara presisi!")
            else:
                print("❌ Gagal menemukan elemen apa pun.")
                
            await browser.close()
            
        except Exception as e:
            print(f"❌ Terjadi kesalahan: {e}")
            print("Pastikan browser dengan remote-debugging-port=9222 sedang terbuka.")

if __name__ == "__main__":
    asyncio.run(run_experiment())
