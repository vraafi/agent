import os
import time
import pyautogui
from PIL import Image
import ast
from dotenv import load_dotenv

# Gunakan SDK baru google-genai
from google import genai

load_dotenv()
api_key = os.environ.get("GEMINI_KEY_1") or os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("❌ API Key tidak ditemukan di .env!")
    exit(1)

# Inisialisasi client baru
client = genai.Client(api_key=api_key)

def run_vision_click():
    print("="*60)
    print("🚀 MEMULAI EKSEKUSI VISUAL AI (google-genai)")
    print("="*60)
    
    print("[1] Mengambil screenshot dari desktop...")
    time.sleep(2)
    screenshot = pyautogui.screenshot()
    screenshot_path = "current_screen.png"
    screenshot.save(screenshot_path)
    print(f"[*] Screenshot disimpan di {screenshot_path}")
    
    print("\n[2] Menganalisis gambar...")
    prompt = (
        "Analyze this screenshot of a computer screen. "
        "Find the exact pixel coordinates (x, y) for the main 'Next', 'Submit', 'Lanjut', 'Mulai survei' button, "
        "or the center of the main survey text input box. "
        "Respond ONLY with a Python tuple of integers, for example: (600, 450). "
        "If no such element is visible, return (0, 0)."
    )
    
    models_to_try = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-1.5-pro']
    response = None
    
    for model_name in models_to_try:
        try:
            print(f"[*] Mencoba model: {model_name}...")
            response = client.models.generate_content(
                model=model_name,
                contents=[prompt, Image.open(screenshot_path)]
            )
            if response and response.text:
                print(f"[*] Model {model_name} berhasil merespons!")
                break
        except Exception as e:
            print(f"[-] Model {model_name} gagal: {e}")
            
    if not response or not response.text:
        print("❌ Semua model gagal merespons.")
        return
        
    try:
        teks_koordinat = response.text.strip().replace('`', '').replace('python', '').strip()
        print(f"[*] Hasil analisis koordinat dari Vision AI: {teks_koordinat}")
        
        try:
            x, y = ast.literal_eval(teks_koordinat)
            if x > 0 and y > 0:
                print(f"\n[3] Mengeksekusi pergerakan mouse ke X: {x}, Y: {y}")
                pyautogui.moveTo(x, y, duration=1.5)
                print("[*] Mengeklik elemen...")
                pyautogui.click()
                print("✅ Eksekusi klik visual BERHASIL dilakukan secara otonom!")
                
                print("[*] Menyuntikkan teks opini melalui keyboard emulator...")
                opini = "Menjadi Solusi, Bukan Beban."
                time.sleep(1)
                pyautogui.typewrite(opini, interval=0.02)
                print("✅ Injeksi teks selesai.")
            else:
                print("\n❌ Vision AI tidak dapat mendeteksi elemen.")
        except Exception as parse_e:
            print(f"\n❌ Gagal memparsing koordinat: {parse_e}")
            
    except Exception as e:
        print(f"\n❌ Terjadi kesalahan pada proses Vision AI: {e}")

if __name__ == "__main__":
    run_vision_click()
