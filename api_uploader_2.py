import os
from dotenv import load_dotenv
from instagrapi import Client

def main():
    load_dotenv()
    
    USERNAME = os.environ.get("IG_USERNAME")
    PASSWORD = os.environ.get("IG_PASSWORD")
    
    cl = Client()
    print(f"Mencoba login ke Instagram sebagai {USERNAME}...")
    try:
        cl.login(USERNAME, PASSWORD)
        print("Login berhasil!")
    except Exception as e:
        print(f"Gagal login: {e}")
        return

    # Post 2
    print("\nMengunggah Postingan ke-2 (Before-After)...")
    img2 = r"C:\Users\user\.gemini\antigravity\brain\d70f0f4b-a00f-47fc-b3c4-a1aa47aa935e\post2_before_after_1780153287365.png"
    cap2 = "Jangan biarkan feed Anda seperti brosur mati. Ubah menjadi mesin konversi. Geser untuk melihat perbedaannya! #copywritingfnb #jasakonten"
    try:
        media2 = cl.photo_upload(img2, cap2)
        print(f"SUKSES POST 2! Tautan: https://www.instagram.com/p/{media2.code}/")
    except Exception as e:
        print(f"Gagal Post 2: {e}")

    # Post 3
    print("\nMengunggah Postingan ke-3 (Kata Ajaib)...")
    img3 = r"C:\Users\user\.gemini\antigravity\brain\d70f0f4b-a00f-47fc-b3c4-a1aa47aa935e\post3_kata_ajaib_1780153304593.png"
    cap3 = "Satu kata bisa mengubah 'nanti deh' menjadi 'pesan sekarang'. Gunakan 3 kata ajaib ini di postingan kuliner Anda hari ini! #tipsbisniskuliner #marketingfnb"
    try:
        media3 = cl.photo_upload(img3, cap3)
        print(f"SUKSES POST 3! Tautan: https://www.instagram.com/p/{media3.code}/")
    except Exception as e:
        print(f"Gagal Post 3: {e}")

if __name__ == "__main__":
    main()
