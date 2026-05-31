import os
import time
import pyautogui
import google.generativeai as genai
from PIL import Image
import ast
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get("GEMINI_KEY_1") or os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("❌ API Key tidak ditemukan di .env!")
    exit(1)

genai.configure(api_key=api_key)

def run_vision_click():
    print("="*60)
    print("🚀 MEMULAI EKSEKUSI VISUAL AI (SCREENSHOT & KLIK)")
    print("="*60)
    
    print("[1] Mengambil screenshot dari desktop (Cloak Browser harus terlihat)...")
    time.sleep(2)
    screenshot = pyautogui.screenshot()
    screenshot_path = "current_screen.png"
    screenshot.save(screenshot_path)
    print(f"[*] Screenshot disimpan sementara di {screenshot_path}")
    
    print("\n[2] Menganalisis gambar menggunakan Gemini Vision AI...")
    prompt = (
        "Analyze this screenshot of a computer screen. "
        "Find the exact pixel coordinates (x, y) for the main 'Next', 'Submit', 'Lanjut', 'Mulai survei' button, "
        "or the center of the main survey text input box. "
        "Respond ONLY with a Python tuple of integers, for example: (600, 450). "
        "If no such element is visible, return (0, 0)."
    )
    
    models_to_try = ['gemini-1.5-pro', 'gemini-pro-vision', 'gemini-1.5-flash']
    response = None
    
    for model_name in models_to_try:
        try:
            print(f"[*] Mencoba model: {model_name}...")
            model = genai.GenerativeModel(model_name)
            response = model.generate_content([prompt, Image.open(screenshot_path)])
            if response:
                print(f"[*] Model {model_name} berhasil merespons!")
                break
        except Exception as e:
            print(f"[-] Model {model_name} gagal: {e}")
            
    if not response:
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
                
                # Coba ketik teks jika asumsinya itu kotak teks
                print("[*] Menyuntikkan teks opini melalui keyboard emulator...")
                opini = "Menjadi Solusi, Bukan Beban. Fokus pada prioritas Eisenhower Matrix."
                time.sleep(1)
                pyautogui.typewrite(opini, interval=0.02)
                print("✅ Injeksi teks selesai.")
                
            else:
                print("\n❌ Vision AI tidak dapat mendeteksi tombol atau kotak form yang relevan di layar.")
        except Exception as parse_e:
            print(f"\n❌ Gagal memparsing koordinat dari respons AI: {parse_e}")
            
    except Exception as e:
        print(f"\n❌ Terjadi kesalahan pada proses Vision AI: {e}")

if __name__ == "__main__":
    run_vision_click()
