import os
import cv2
import json
import logging
import requests
from faster_whisper import WhisperModel
from moviepy.editor import VideoFileClip, TextClip, CompositeVideoClip, AudioFileClip, vfx

# Gunakan api_client yang sudah ada di Nexus
try:
    from api_client import GeminiClient
    from llm_config import DEFAULT_LLM_MODEL
except ImportError:
    pass

logger = logging.getLogger(__name__)

PEXELS_API_KEY = os.environ.get("PEXELS_API_KEY", "")

class VideoClippingAgent:
    def __init__(self, llm_client=None):
        self.llm = llm_client
        self.whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
        
        # Load HaarCascade for face detection
        cascade_path = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        self.face_cascade = cv2.CascadeClassifier(cascade_path)

    def transcribe_audio(self, video_path: str) -> list:
        """Extract audio and transcribe using Whisper."""
        logger.info(f"Transcribing video: {video_path}")
        segments, info = self.whisper_model.transcribe(video_path, beam_size=5)
        
        transcript_data = []
        full_text = ""
        for segment in segments:
            transcript_data.append({
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip()
            })
            full_text += f"[{segment.start:.2f} - {segment.end:.2f}] {segment.text}\n"
            
        return transcript_data, full_text

    def get_viral_clip_cues(self, full_text: str) -> dict:
        """Kirim transkrip ke LLM untuk memilih klip paling viral dan rekomendasi B-Roll."""
        if not self.llm:
            logger.error("LLM Client is missing.")
            return {}

        prompt = (
            "Kamu adalah editor video podcast sekelas Alex Hormozi. Analisis transkrip berikut:\n\n"
            f"{full_text}\n\n"
            "Tugasmu:\n"
            "1. Pilih SATU momen paling viral (berdurasi antara 15 hingga 50 detik) yang memiliki hook kuat dan kesimpulan menohok.\n"
            "2. Tentukan satu adegan B-Roll (visual stok) yang harus muncul di tengah-tengah klip selama 2-4 detik untuk menekankan poin penting.\n\n"
            "Kembalikan HANYA format JSON murni dengan struktur berikut:\n"
            "{\n"
            '  "clip_start": 10.5,\n'
            '  "clip_end": 45.0,\n'
            '  "b_roll_keyword": "rocket launching",\n'
            '  "b_roll_start_relative": 5.0, // Detik ke berapa B-roll muncul (relatif dari awal klip)\n'
            '  "b_roll_duration": 3.0,\n'
            '  "reasoning": "Alasan singkat mengapa ini viral"\n'
            "}"
        )

        response = self.llm.generate_content(prompt, require_json=True)
        try:
            # Parse json string to dict
            # Jika response mengandung markdown, buang.
            if "```json" in response:
                response = response.split("```json")[1].split("```")[0].strip()
            return json.loads(response)
        except Exception as e:
            logger.error(f"Failed to parse LLM JSON: {e}")
            return {}

    def fetch_b_roll(self, keyword: str, output_path: str) -> str:
        """Cari dan download video dari Pexels berdasarkan keyword."""
        if not PEXELS_API_KEY:
            logger.warning("PEXELS_API_KEY tidak ada. Mengabaikan B-Roll.")
            return None
            
        logger.info(f"Mencari B-Roll di Pexels untuk: {keyword}")
        url = f"https://api.pexels.com/videos/search?query={keyword}&orientation=portrait&size=medium&per_page=1"
        headers = {"Authorization": PEXELS_API_KEY}
        
        try:
            res = requests.get(url, headers=headers)
            if res.status_code == 200:
                data = res.json()
                if data.get("videos"):
                    video_files = data["videos"][0]["video_files"]
                    # Ambil file resolusi SD atau HD
                    link = video_files[0]["link"]
                    
                    video_data = requests.get(link).content
                    with open(output_path, "wb") as f:
                        f.write(video_data)
                    return output_path
        except Exception as e:
            logger.error(f"Gagal mendownload B-Roll: {e}")
        return None

    def auto_crop_face(self, input_path: str, output_path: str, target_ratio: float = 9/16):
        """Memotong video agar rasio 9:16 dan wajah tetap di tengah menggunakan OpenCV & MoviePy."""
        # TODO: Implementasi Face Tracking dinamis dengan smoothing
        # Versi simplifikasi: Ambil center frame jika deteksi wajah terlalu lambat
        
        clip = VideoFileClip(input_path)
        w, h = clip.size
        
        target_w = int(h * target_ratio)
        
        if target_w >= w:
            logger.info("Video sudah vertikal atau rasio terlalu kecil.")
            clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
            return
            
        x_center = w / 2
        x1 = max(0, int(x_center - target_w / 2))
        x2 = min(w, int(x_center + target_w / 2))
        
        cropped_clip = clip.crop(x1=x1, y1=0, x2=x2, y2=h)
        cropped_clip.write_videofile(output_path, codec="libx264", audio_codec="aac")
        clip.close()
        cropped_clip.close()

    def process_video(self, video_path: str, output_dir: str):
        """Fungsi utama pipeline Clipping - Mendelegasikan ke opensource-clipping engine."""
        import subprocess
        import glob
        
        base_name = os.path.splitext(os.path.basename(video_path))[0]
        wrapper_script = os.path.join(os.path.dirname(__file__), "bin", "opensource-clipping", "run_local.py")
        repo_dir = os.path.join(os.path.dirname(__file__), "bin", "opensource-clipping")
        
        # Bersihkan folder outputs sebelumnya agar tidak bentrok
        outputs_dir = os.path.join(repo_dir, "outputs")
        if os.path.exists(outputs_dir):
            for f in glob.glob(os.path.join(outputs_dir, "*.mp4")):
                try: os.remove(f)
                except: pass
        
        logger.info(f"Menjalankan Hybrid Clipping Engine (NaufalRizqullah + Claude 3.5 Sonnet) untuk {video_path}")
        
        # Eksekusi wrapper
        # --clips 1 karena kita hanya ingin 1 potongan terbaik untuk dikembalikan ke user via bot
        # --face-detector yolo (lebih stabil untuk wajah) atau mediapipe
        cmd = [
            "python", wrapper_script, video_path, 
            "--clips", "10", 
            "--face-detector", "mediapipe",
            "--ratio", "9:16",
            "--font-style", "HORMOZI",
            "--no-bgm"
        ]
        
        try:
            result = subprocess.run(cmd, cwd=repo_dir, capture_output=True, text=True, encoding="utf-8")
            logger.info("Subprocess selesai.")
            if result.returncode != 0:
                logger.error(f"Error dari clipping engine: {result.stderr}")
                return None
        except Exception as e:
            logger.error(f"Gagal memanggil clipping engine: {e}")
            return None
            
        # Cari file output
        output_files = glob.glob(os.path.join(outputs_dir, "highlight_rank_*_ready.mp4"))
        if output_files:
            final_outputs = []
            import shutil
            for i, f in enumerate(output_files):
                final_out = os.path.join(output_dir, f"{base_name}_clip_{i+1}.mp4")
                shutil.copy(f, final_out)
                final_outputs.append(final_out)
            return final_outputs
            
        logger.error("Tidak ada file output yang ditemukan di folder outputs/.")
        return None

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    from api_client import GeminiClient
    from llm_config import DEFAULT_LLM_MODEL
    
    # Init LLM (Google APIs atau 9Router)
    # Gunakan Keys dari env
    keys = [os.environ.get("GEMINI_KEY_1")]
    client = GeminiClient(api_keys=keys)
    
    agent = VideoClippingAgent(llm_client=client)
    # Test dengan dummy video jika ada
    # agent.process_video("sample.mp4", "./out")
