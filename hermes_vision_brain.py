import os
import json
import time
import base64
import asyncio
import websockets
import requests
import random
from typing import List, Dict

# Parse .env
def load_env():
    keys = []
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("GEMINI_KEY_"):
                    key = line.split("=", 1)[1].strip()
                    keys.append(key)
    return keys

API_KEYS = load_env()
if not API_KEYS:
    print("WARNING: No GEMINI_KEY found in .env")
    API_KEYS = ["YOUR_API_KEY_HERE"]

class HermesVisionBrain:
    def __init__(self):
        self.key_index = 0
        self.active_ws = None
        self.processing = False

    def get_next_key(self):
        key = API_KEYS[self.key_index]
        self.key_index = (self.key_index + 1) % len(API_KEYS)
        return key

    async def log_to_hud(self, message: str):
        print(f"[Brain] {message}")
        if self.active_ws:
            await self.active_ws.send(json.dumps({"action": "HUD_LOG", "message": message}))

    def log_to_hermes_memory(self, ai_response_json: dict):
        """Menulis memori aksi visual secara pasif ke memori Hermes Agent Asli (Mendukung WSL & Windows)."""
        try:
            import datetime
            import subprocess
            
            # 1. Tulis ke Windows Native Path
            memory_dir = os.path.expanduser("~/.hermes/memory")
            os.makedirs(memory_dir, exist_ok=True)
            log_path = os.path.join(memory_dir, "outreach_logs.md")
            
            timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            action = ai_response_json.get("action", "UNKNOWN")
            thought = ai_response_json.get("thought", "")
            
            log_entry = f"\n### [Visual Bridge] {timestamp}\n"
            log_entry += f"- **Target Platform**: LinkedIn\n"
            log_entry += f"- **Aksi Dieksekusi**: `{action}`\n"
            if thought:
                log_entry += f"- **Pemikiran Visi AI**: {thought}\n"
            
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(log_entry)
                
            # 2. Tulis ke WSL Path secara paksa (karena user menjalankan Hermes CLI di WSL)
            try:
                # Perintah WSL akan mengeksekusi shell bash dan menambahkan teks ke file
                wsl_cmd = f'mkdir -p ~/.hermes/memory && cat << "EOF" >> ~/.hermes/memory/outreach_logs.md\n{log_entry}\nEOF'
                subprocess.run(["wsl", "bash", "-c", wsl_cmd], capture_output=True)
            except Exception as wsl_e:
                print(f"WSL Sync warning: {wsl_e}")
                
        except Exception as e:
            print(f"Gagal menulis ke memori Hermes Asli: {e}")

    async def call_gemma_vision(self, image_data_url: str, prompt: str) -> Dict:
        """Call Gemini API using round-robin keys with auto-healing for dead keys"""
        base64_img = image_data_url.split(",")[1]
        
        payload = {
            "contents": [{
                "parts": [
                    {"text": prompt},
                    {"inlineData": {
                        "mimeType": "image/jpeg",
                        "data": base64_img
                    }}
                ]
            }],
            "generationConfig": {
                "responseMimeType": "application/json",
            }
        }
        
        loop = asyncio.get_event_loop()
        
        while len(API_KEYS) > 0:
            api_key = self.get_next_key()
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key={api_key}"
            
            await self.log_to_hud(f"Mengirim memori visual ke Gemma 4 (31B) dengan Key {API_KEYS.index(api_key)+1}...")
            
            def do_req():
                return requests.post(url, json=payload, headers={"Content-Type": "application/json"})
                
            try:
                response = await loop.run_in_executor(None, do_req)
                if response.status_code == 200:
                    data = response.json()
                    final_text = ""
                    for part in data["candidates"][0]["content"]["parts"]:
                        if not part.get("thought"):
                            final_text = part["text"]
                            break
                    return json.loads(final_text)
                elif response.status_code == 403:
                    await self.log_to_hud(f"Key {API_KEYS.index(api_key)+1} ditolak (403 PERMISSION DENIED). Menghapus key dari rotasi...")
                    API_KEYS.remove(api_key)
                    # Loop akan berputar ke key berikutnya
                    continue
                elif response.status_code >= 500:
                    await self.log_to_hud(f"Server Google sibuk/mati (500 INTERNAL). Langsung mencoba key berikutnya...")
                    # Coba key selanjutnya tanpa menghapusnya dari rotasi
                    continue
                else:
                    await self.log_to_hud(f"Error API {response.status_code}: {response.text[:200]}")
                    print(response.text)
                    return {"error": "API Error"}
            except Exception as e:
                await self.log_to_hud(f"JSON Parse Error: {e}")
                return {"error": str(e)}
                
        await self.log_to_hud("Semua API Key habis atau tidak valid!")
        return {"error": "NO_VALID_KEYS"}

    async def handle_connection(self, ws):
        print("Ekstensi Chrome Terhubung ke Vision Brain!")
        self.active_ws = ws
        try:
            async for message in ws:
                data = json.loads(message)
                
                if data.get("type") == "VISION_STEP_REQUEST":
                    if not self.processing:
                        self.processing = True
                        await self.log_to_hud("Menerima request visual dari ekstensi...")
                        asyncio.create_task(self.process_vision_step(data["screenshot"], data.get("domData", "")))
                        
                elif data.get("type") == "SCREENSHOT_RESULT":
                    # Lanjutan dari action (tanpa domData baru karena ini verifikasi)
                    asyncio.create_task(self.process_vision_step(data["data"], ""))
                    
                elif data.get("type") == "ACTION_RESULT":
                    await self.log_to_hud(f"Tindakan {data['action']} berhasil. Memverifikasi...")
                    await asyncio.sleep(2)
                    # Minta screenshot baru untuk memverifikasi tindakan
                    await ws.send(json.dumps({"action": "GET_SCREENSHOT"}))
                    
        except websockets.exceptions.ConnectionClosed:
            print("Ekstensi Terputus.")
        finally:
            self.active_ws = None
            self.processing = False

    async def process_vision_step(self, screenshot: str, dom_data: str):
        prompt = f"""Kamu adalah AI Agent yang mengendalikan browser untuk proses outreach LinkedIn.
Gambar ini adalah tangkapan layar browser saat ini.

DATA KOORDINAT TOMBOL YANG TERSEDIA DI LAYAR:
{dom_data if dom_data else "Tidak ada data tombol spesifik. Gunakan estimasi visual."}

Tugasmu:
1. Analisis layar untuk mencari tombol "Connect" atau "Hubungkan" pada prospek.
2. Jika ada modal (kotak dialog) terbuka, cari tombol "Send", "Kirim", "Kirim tanpa catatan", atau "Add a note".
3. Jika modal meminta catatan, kita harus mengirim teks. 

KEMBALIKAN OUTPUT DALAM FORMAT JSON BERIKUT (TANPA MARKDOWN):
{{
  "thought": "Penjelasan singkat apa yang kamu lihat dan apa yang harus dilakukan",
  "action": "CLICK" | "TYPE" | "WAIT" | "DONE",
  "x": <koordinat X (integer) dari tengah tombol target, gunakan data koordinat di atas jika tersedia>,
  "y": <koordinat Y (integer) dari tengah tombol target, gunakan data koordinat di atas jika tersedia>,
  "text": "<teks yang akan diketik jika action=TYPE>"
}}

PENTING UNTUK KOORDINAT:
- Pastikan x, y tepat di tengah tombol yang relevan, SANGAT DISARANKAN memilih angka X dan Y dari DATA KOORDINAT di atas daripada menebak sendiri.
- Jika tidak ada target tersisa, set action="DONE".
"""
        await self.log_to_hud("Menganalisis layar menggunakan Gemma Vision...")
        result = await self.call_gemma_vision(screenshot, prompt)
        
        if "error" in result:
            await self.log_to_hud("Mencoba ulang dalam 5 detik...")
            await asyncio.sleep(5)
            self.processing = False
            return
            
        thought = result.get("thought", "")
        action = result.get("action", "DONE")
        x = result.get("x", 0)
        y = result.get("y", 0)
        
        await self.log_to_hud(f"Pemikiran: {thought}")
        
        if action == "CLICK":
            await self.log_to_hud(f"Memerintahkan Native Click ke ({x}, {y})")
            if self.active_ws:
                await self.active_ws.send(json.dumps({"action": "CLICK", "x": x, "y": y}))
        elif action == "TYPE":
            text = result.get("text", "")
            await self.log_to_hud(f"Mengetik teks: {text[:20]}...")
            if self.active_ws:
                await self.active_ws.send(json.dumps({"action": "TYPE", "text": text}))
        elif action == "DONE":
            await self.log_to_hud("Siklus selesai atau tidak ada prospek/target tersisa.")
            self.processing = False

async def main():
    brain = HermesVisionBrain()
    server = await websockets.serve(brain.handle_connection, "127.0.0.1", 3033)
    print("==================================================")
    print("Hermes Vision Brain (Gemma-4 + API Keys) AKTIF")
    print(f"Menggunakan {len(API_KEYS)} API Keys secara Round-Robin")
    print("Menunggu koneksi dari Ekstensi Chrome...")
    print("==================================================")
    await asyncio.Future()  # run forever

if __name__ == "__main__":
    asyncio.run(main())
