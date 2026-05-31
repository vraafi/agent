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

    print("\nMengunggah Foto Profil...")
    pic_path = r"C:\Users\user\.gemini\antigravity\brain\d70f0f4b-a00f-47fc-b3c4-a1aa47aa935e\profile_pic_agency_1780159229138.png"
    
    try:
        cl.account_change_picture(pic_path)
        print("SUKSES! Foto profil berhasil diubah.")
    except Exception as e:
        print(f"Gagal mengubah foto profil: {e}")

if __name__ == "__main__":
    main()
