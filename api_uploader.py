import os
from dotenv import load_dotenv
from instagrapi import Client

def main():
    load_dotenv()
    
    USERNAME = os.environ.get("IG_USERNAME")
    PASSWORD = os.environ.get("IG_PASSWORD")
    
    if not USERNAME or not PASSWORD or "username_ig_anda" in USERNAME:
        print("ERROR: Harap isi IG_USERNAME dan IG_PASSWORD di file .env terlebih dahulu!")
        print("Buka file .env dan ubah nilainya.")
        return

    cl = Client()
    
    print(f"Mencoba login ke Instagram sebagai {USERNAME}...")
    try:
        cl.login(USERNAME, PASSWORD)
        print("Login berhasil!")
    except Exception as e:
        print(f"Gagal login: {e}")
        return

    print("Memproses pengunggahan gambar ke Feed Instagram...")
    
    # Path gambar postingan pertama
    img_path = r"C:\Users\user\.gemini\antigravity\brain\d70f0f4b-a00f-47fc-b3c4-a1aa47aa935e\post1_edukasi_copywriting_1780153233334.png"
    caption = "Visual yang bagus bikin orang berhenti scroll, tapi copywriting yang tajamlah yang bikin mereka klik tombol pesan. Jangan biarkan foto mahal Anda sia-sia. Perbaiki caption Anda sekarang. DM saya! #copywritingfnb #evanfisher"
    
    try:
        media = cl.photo_upload(
            img_path,
            caption
        )
        print(f"\nSUKSES BESAR! Foto berhasil diunggah secara instan.")
        print(f"Tautan postingan: https://www.instagram.com/p/{media.code}/")
    except Exception as e:
        print(f"\nGagal mengunggah foto: {e}")

if __name__ == "__main__":
    main()
