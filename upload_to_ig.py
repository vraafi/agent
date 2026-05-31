import asyncio
from browser_agent import BrowserAgent, GemmaDirectAgent
import sys

async def main():
    print("Memulai Hermes Agent untuk Upload Postingan Pertama ke Instagram...")
    base = BrowserAgent()
    
    # Path gambar yang dibuat sebelumnya
    img_path = r"C:\Users\user\.gemini\antigravity\brain\d70f0f4b-a00f-47fc-b3c4-a1aa47aa935e\post1_edukasi_copywriting_1780153233334.png"
    
    task_prompt = (
        "TARGET URL: https://www.instagram.com . "
        "MISI: Buat postingan Instagram baru. "
        "LANGKAH-LANGKAH: "
        "1. Navigasi ke instagram.com (jangan login jika sudah masuk). "
        "2. Cari dan klik tombol 'Create' (Buat) atau ikon '+' di sidebar. "
        f"3. Saat modal 'Create new post' muncul, cari elemen input file dan lakukan aksi 'upload' menggunakan path berikut: {img_path} . "
        "4. Jika upload berhasil, klik tombol 'Next' (Selanjutnya) di sudut kanan atas modal dua kali sampai Anda melihat kolom penulisan caption. "
        "5. Ketik caption berikut di kolom teks: 'Visual yang bagus bikin orang berhenti scroll, tapi copywriting yang tajamlah yang bikin mereka klik tombol pesan. Jangan biarkan foto mahal Anda sia-sia. Perbaiki caption Anda sekarang. DM saya! #copywritingfnb #evanfisher' . "
        "6. Klik tombol 'Share' (Bagikan) dan tunggu hingga proses unggah selesai. "
        "7. Nyatakan 'done' jika berhasil."
    )
    
    agent = GemmaDirectAgent(task_prompt, browser=None, gemma_caller=base._gemma_primary, max_steps=20)
    result = await agent.run()
    print("\n--- HASIL EKSEKUSI ---")
    print(result)

if __name__ == "__main__":
    import os
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass
    
    # Do NOT set WindowsSelectorEventLoopPolicy as it breaks Playwright
    asyncio.run(main())
