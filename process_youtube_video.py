import os
import sys
import time
import requests
import yt_dlp
from dotenv import load_dotenv

os.environ["PYTHONIOENCODING"] = "utf-8"
os.environ["PYTHONUTF8"] = "1"

def download_youtube_video(url, output_dir):
    print(f"[*] Mengunduh video kualitas terbaik dari YouTube: {url}")
    ydl_opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': os.path.join(output_dir, 'yt_video_%(id)s.%(ext)s'),
        'merge_output_format': 'mp4',
        'ffmpeg_location': r'C:\Users\user\.antigravity\Nexus-DualBrain-AI\bin\opensource-clipping\ffmpeg.exe',
        'quiet': False
    }
    
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info_dict = ydl.extract_info(url, download=True)
        video_id = info_dict.get("id", "unknown")
        filename = ydl.prepare_filename(info_dict)
        if not filename.endswith('.mp4'):
            filename = filename.rsplit('.', 1)[0] + '.mp4'
            
    print(f"[+] Berhasil mengunduh ke: {filename}")
    return filename

def main():
    if len(sys.argv) < 2:
        print("Penggunaan: python process_youtube_video.py <LINK_YOUTUBE>")
        sys.exit(1)
        
    youtube_url = sys.argv[1]
    
    # Setup Environtment
    load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))
    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    
    temp_dir = os.path.join(os.path.dirname(__file__), ".tempmediaStorage")
    os.makedirs(temp_dir, exist_ok=True)
    
    # 1. Download Video
    try:
        filepath = download_youtube_video(youtube_url, temp_dir)
    except Exception as e:
        print(f"[ERROR] Gagal mengunduh video YouTube: {e}")
        sys.exit(1)
        
    # 2. Proses Clipping
    print("\n[*] Memulai proses AI Clipping...")
    from video_clipping_agent import VideoClippingAgent
    agent = VideoClippingAgent()
    final_videos = agent.process_video(filepath, temp_dir)
    
    if final_videos and isinstance(final_videos, list):
        print(f"\n[*] Clipping selesai! Memproses {len(final_videos)} video untuk di-upload.")
        
        if not bot_token or not chat_id:
            print("[!] Telegram credentials tidak lengkap di .env. Lewati pengiriman Telegram.")
        else:
            for i, final_video in enumerate(final_videos):
                print(f"[*] Mengunggah klip {i+1} ke Cloud (file.io) agar kualitas 100% utuh...")
                
                try:
                    # Upload ke catbox.moe untuk mendapat link raw berkualitas
                    with open(final_video, 'rb') as f:
                        file_resp = requests.post('https://catbox.moe/user/api.php', data={'reqtype': 'fileupload'}, files={'fileToUpload': f})
                    
                    if file_resp.status_code == 200:
                        link = file_resp.text.strip()
                        print(f"[+] Link unduhan berhasil dibuat: {link}")
                        
                        # Coba ambil caption dari gemini_response.json
                        ai_caption = ""
                        try:
                            json_path = os.path.join(os.path.dirname(__file__), "bin", "opensource-clipping", "outputs", "gemini_response.json")
                            if os.path.exists(json_path):
                                import json
                                with open(json_path, 'r', encoding='utf-8') as jf:
                                    metadata = json.load(jf)
                                    if i < len(metadata):
                                        tiktok_cap = metadata[i].get('tiktok_caption_id', '')
                                        tags = metadata[i].get('hastag', '')
                                        if tiktok_cap:
                                            ai_caption = f"\n\n📝 *Auto-Caption (TikTok/IG):*\n{tiktok_cap} {tags}"
                        except Exception as e:
                            print(f"[!] Gagal mengambil caption dari JSON: {e}")

                        # Kirim tautan ke Telegram
                        url_tg = f"https://api.telegram.org/bot{bot_token}/sendMessage"
                        caption = (
                            f"🎬 *Nexus DualBrain AI*\n\n"
                            f"Berhasil merender klip {i+1} dari {len(final_videos)}!\n\n"
                            f"✅ *In-Media-Res Start* (No Dead Air)\n"
                            f"✅ *Seamless Loop* (No Padding)\n"
                            f"✅ *Color Graded* (FFmpeg Filter)\n\n"
                            f"📥 Unduh video resolusi 8K/4K penuh di sini:\n{link}"
                            f"{ai_caption}\n\n"
                            f"_Catatan: Harap simpan video ini segera._"
                        )
                        
                        data = {
                            'chat_id': chat_id,
                            'text': caption,
                            'parse_mode': 'Markdown'
                        }
                        
                        resp = requests.post(url_tg, data=data)
                        if resp.status_code == 200:
                            print(f"[SUKSES] Pesan Tautan klip {i+1} terkirim ke Telegram!")
                        else:
                            print(f"[GAGAL] Gagal mengirim pesan ke Telegram: {resp.text}")
                    else:
                        print(f"[ERROR] Gagal upload ke 0x0.st: {file_resp.text}")
                except Exception as e:
                    print(f"[ERROR] Terjadi kesalahan saat pengiriman video {i+1}: {e}")
    else:
        print("[ERROR] Gagal memproses video clipping. Tidak ada hasil video yang dikembalikan.")

if __name__ == "__main__":
    main()
