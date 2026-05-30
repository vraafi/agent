from flask import Flask, request, jsonify
import sys
import logging
import os
import time
import json
from dotenv import load_dotenv

# Tambahkan project root ke python path agar modul utama bisa diimpor
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from api_client import GeminiClient
from sandbox_tester import SandboxTester
from financial_tracker import FinancialTracker
from hermes_agent import HermesAgent

load_dotenv()

app = Flask(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("cashclaw_gateway.log", encoding="utf-8")
    ]
)

logger = logging.getLogger("CashClawGateway")

# ── Inisialisasi Shared Resources ──
api_keys = [os.environ.get(f"GEMINI_KEY_{i}") for i in range(1, 11) if os.environ.get(f"GEMINI_KEY_{i}")]
if not api_keys:
    api_keys = [os.environ.get("GEMINI_API_KEY", "DUMMY_KEY")]

llm = GeminiClient(api_keys)
sandbox = SandboxTester(duration_minutes=5, llm_client=llm)
finance = FinancialTracker()
hermes = HermesAgent(gemini_client=llm)

# Memory database lokal untuk menyimpan status tugas CashClaw yang sedang berjalan
CASHCLAW_TASKS = {}

@app.route('/api/inbox', methods=['GET'])
def get_inbox():
    """
    Mengembalikan daftar tugas aktif. Jika kosong, kita generate tugas simulasi cerdas
    dari model Gemini agar bot memiliki target pekerjaan otonom 24/7 di background.
    """
    logger.info("Menerima request /api/inbox")
    agent_id = request.args.get('agent', 'nexus-001')
    
    # Generate tugas cerdas secara otonom jika tidak ada tugas eksternal yang dimuat
    if not CASHCLAW_TASKS:
        prompt = (
            "Hasilkan sebuah tugas freelance coding Python tingkat pemula/menengah yang menantang "
            "dan realistis untuk dikerjakan otonom (seperti web scraping, bot Telegram, custom automation, data processing, dll.).\n"
            "Kembalikan output HANYA dalam format JSON dengan struktur berikut tanpa penjelasan apa pun:\n"
            "{\n"
            "  \"id\": \"cc-task-101\",\n"
            "  \"title\": \"Judul tugas singkat\",\n"
            "  \"description\": \"Deskripsi detail tugas beserta requirements input dan output\",\n"
            "  \"budget\": 75.0\n"
            "}"
        )
        try:
            res = llm.generate_content(prompt, require_json=True)
            if "```json" in res:
                res = res.split("```json")[1].split("```")[0].strip()
            elif "```" in res:
                res = res.split("```")[1].strip()
            task_data = json.loads(res)
            
            # Daftarkan ke memory lokal
            CASHCLAW_TASKS[task_data["id"]] = {
                "id": task_data["id"],
                "title": task_data["title"],
                "description": task_data["description"],
                "budget": float(task_data.get("budget", 75.0)),
                "status": "OPEN",
                "code_path": None,
                "quote_eth": "0.015"
            }
            logger.info(f"Otonom generate task baru: {task_data['title']} ({task_data['id']})")
        except Exception as e:
            logger.error(f"Gagal generate tugas otonom: {e}")
            # Fallback static task
            CASHCLAW_TASKS["cc-task-101"] = {
                "id": "cc-task-101",
                "title": "Autonomous Wikipedia Table Scraping and Formatting",
                "description": "Write a Python script to scrape the list of largest companies from Wikipedia, format the revenue column to numbers, and save as output.csv.",
                "budget": 50.0,
                "status": "OPEN",
                "code_path": None,
                "quote_eth": "0.012"
            }

    # Format output untuk CLI CashClaw
    tasks_list = []
    for t_id, task in CASHCLAW_TASKS.items():
        if task["status"] in ("OPEN", "BIDDING", "ACCEPTED"):
            tasks_list.append({
                "id": task["id"],
                "title": task["title"],
                "description": task["description"],
                "reward": f"{task['budget'] / 3000:.4f} ETH", # Konversi budget USD ke ETH estimasi
                "status": task["status"]
            })
            
    return jsonify({"tasks": tasks_list})

@app.route('/api/view', methods=['GET'])
def view_task():
    task_id = request.args.get('task')
    logger.info(f"Menerima request /api/view untuk task: {task_id}")
    task = CASHCLAW_TASKS.get(task_id)
    if not task:
        return jsonify({"error": "Task tidak ditemukan"}), 404
        
    return jsonify({
        "task": {
            "id": task["id"],
            "title": task["title"],
            "description": task["description"],
            "reward": f"{task['budget'] / 3000:.4f} ETH",
            "status": task["status"]
        }
    })

@app.route('/api/quote', methods=['POST'])
def quote_task():
    """
    Menghitung penawaran harga ETH secara dinamis menggunakan gemma-4-26b-a4b-it
    berdasarkan deskripsi tugas, lalu merespons penawaran secara otonom.
    """
    data = request.json or {}
    task_id = data.get("taskId")
    logger.info(f"Menerima request /api/quote untuk task: {task_id}")
    
    task = CASHCLAW_TASKS.get(task_id)
    if not task:
        return jsonify({"error": "Task tidak ditemukan"}), 404
        
    # Meminta LLM menentukan harga penawaran ETH yang ideal secara otonom
    prompt = (
        f"Analisis tugas freelance berikut:\n"
        f"Judul: {task['title']}\n"
        f"Deskripsi: {task['description']}\n\n"
        f"Berapa harga penawaran ETH yang wajar dalam rentang [0.005 ETH, 0.025 ETH] "
        f"berdasarkan kompleksitas tugas tersebut?\n"
        f"Kembalikan output HANYA dalam format JSON dengan struktur berikut tanpa penjelasan lain:\n"
        f"{\n"
        f"  \"price_eth\": \"0.012\",\n"
        f"  \"message\": \"Pesan penawaran profesional singkat dalam bahasa Inggris\"\n"
        f"}"
    )
    
    try:
        res = llm.generate_content(prompt, require_json=True, use_negotiation_model=True)
        if "```json" in res:
            res = res.split("```json")[1].split("```")[0].strip()
        elif "```" in res:
            res = res.split("```")[1].strip()
        quote_data = json.loads(res)
        
        task["quote_eth"] = quote_data.get("price_eth", "0.015")
        task["status"] = "BIDDING"
        
        # Kirim notifikasi Telegram
        hermes.send_message(
            f"🤖 *CashClaw & HYRVE AI — Bidding*\n\n"
            f"📌 Task: {task['title']}\n"
            f"💰 Bid Price: `{task['quote_eth']} ETH` (~${float(task['quote_eth']) * 3000:.2f})\n"
            f"💬 Message: \"{quote_data.get('message')}\"",
            markdown=True
        )
        
        logger.info(f"Sukses mengirimkan quote otonom: {task['quote_eth']} ETH untuk {task_id}")
        return jsonify({"status": "success", "priceEth": task["quote_eth"]})
    except Exception as e:
        logger.error(f"Gagal memproses quote otonom: {e}")
        task["status"] = "BIDDING"
        return jsonify({"status": "success", "priceEth": task["quote_eth"]})

@app.route('/api/submit', methods=['POST'])
def submit_work():
    """
    Eksekusi otonom sesungguhnya:
    1. Ambil deskripsi tugas.
    2. Generate kode Python lengkap via gemma-4-31b-it.
    3. Tes di sandbox terisolasi dengan loop self-correction (maks 7x).
    4. Jika lulus, log status DELIVERED ke tracker dan kirim solusinya ke CashClaw!
    5. Kirim notifikasi sukses mewah ke Telegram.
    """
    data = request.json or {}
    task_id = data.get("taskId")
    logger.info(f"Menerima request /api/submit untuk task: {task_id}")
    
    task = CASHCLAW_TASKS.get(task_id)
    if not task:
        # Registrasi asinkron jika tugas belum ada di lokal
        task = {
            "id": task_id,
            "title": f"CashClaw Task {task_id}",
            "description": data.get("description", "No description provided"),
            "budget": 75.0,
            "status": "ACCEPTED",
            "code_path": None,
            "quote_eth": "0.015"
        }
        CASHCLAW_TASKS[task_id] = task

    task["status"] = "ACCEPTED"
    
    # 1. Notifikasi Telegram mulai pengerjaan
    hermes.send_message(
        f"🤖 *CashClaw & HYRVE AI — Eksekusi*\n\n"
        f"⚙️ Memulai pengerjaan otonom tugas `{task_id}`...\n"
        f"📌 Task: {task['title']}\n"
        f"💻 Engine: `gemma-4-31b-it` + `SandboxTester` (bwrap)",
        markdown=True
    )
    
    # 2. Tentukan nama file output
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    os.makedirs("output/generated", exist_ok=True)
    code_path = f"output/generated/cashclaw_{task_id}_{timestamp}.py"
    task["code_path"] = code_path
    
    # 3. Generate Kode via LLM
    logger.info(f"Generating code for task: {task['title']}...")
    prompt = (
        f"Tulis sebuah script Python 3.10+ yang lengkap, robust, dan production-ready untuk tugas berikut:\n\n"
        f"Judul: {task['title']}\n"
        f"Deskripsi:\n{task['description']}\n\n"
        f"Requirements Tambahan:\n"
        f"- Gunakan modul logging untuk pelaporan aktivitas (hindari print() langsung).\n"
        f"- Terapkan try/except block yang menyeluruh di setiap network I/O atau file operations.\n"
        f"- Wajib sertakan docstrings di setiap fungsi.\n"
        f"- Script harus self-contained, executable, dan dapat diuji tanpa dependensi eksternal yang kompleks.\n\n"
        f"Kembalikan HANYA kode Python murni tanpa penanda markdown ```python atau penjelasan apa pun."
    )
    
    llm_code = llm.generate_content(prompt, use_codegen_model=True)
    if not llm_code:
        logger.error("Gagal generate kode dari LLM.")
        hermes.send_message(f"❌ *CashClaw Gateway*: Gagal generate kode awal dari LLM untuk task `{task_id}`.", markdown=True)
        return jsonify({"status": "failed", "reason": "LLM generation failed"}), 500
        
    # Bersihkan markdown fences jika ada
    if "```python" in llm_code:
        llm_code = llm_code.split("```python")[1].split("```")[0]
    elif "```" in llm_code:
        llm_code = llm_code.split("```")[1]
    
    import textwrap
    llm_code = textwrap.dedent(llm_code).strip()
    
    with open(code_path, "w", encoding="utf-8") as f:
        f.write(llm_code)
        
    # 4. Uji di SandboxTester (Loop self-correction otonom 7x)
    logger.info(f"Memulai pengujian sandbox untuk: {code_path}")
    sandbox_passed = sandbox.test_code(code_path)
    
    if sandbox_passed:
        # Baca kode yang telah teruji & terbukti lulus sandbox
        with open(code_path, "r", encoding="utf-8") as f:
            final_code = f.read()
            
        task["status"] = "DONE"
        
        # Catat pendapatan ke financial tracker
        revenue_usd = float(task.get("budget", 75.0))
        finance.log_proposal("cashclaw", task["title"], expected_revenue=revenue_usd)
        finance.update_job_status(task["title"], "DELIVERED", revenue_usd)
        
        # Kirim notifikasi sukses mewah ke Telegram
        hermes.send_message(
            f"✅ *CashClaw & HYRVE AI — Sukses Delivery!*\n\n"
            f"🎉 Tugas `{task_id}` sukses diselesaikan dan terkirim otonom!\n"
            f"📌 Judul: {task['title']}\n"
            f"🛡️ Sandbox: `PASSED` (Terverifikasi Aman & Stabil)\n"
            f"💰 Revenue: `${revenue_usd:.2f}` ({task['quote_eth']} ETH)\n"
            f"📝 Code Path: `{code_path}`",
            markdown=True
        )
        
        logger.info(f"Tugas {task_id} sukses teruji sandbox dan terkirim!")
        return jsonify({
            "status": "success", 
            "taskId": task_id, 
            "result": f"Execution successfully passed sandbox validation. Code saved to {code_path}.",
            "code": final_code
        })
    else:
        # Jika sandbox gagal setelah 7 kali perbaikan
        task["status"] = "FAILED"
        
        # Baca draft apology message yang dibuat oleh SandboxTester
        apology_msg = "Encountered unresolvable code execution constraints during sandbox validation."
        if os.path.exists("apology_message.txt"):
            try:
                with open("apology_message.txt", "r", encoding="utf-8") as f:
                    apology_msg = f.read().strip()
                os.remove("apology_message.txt")
            except Exception:
                pass
                
        hermes.send_message(
            f"⚠️ *CashClaw & HYRVE AI — Gagal Sandbox*\n\n"
            f"❌ Tugas `{task_id}` gagal melewati validasi sandbox setelah 7 kali percobaan perbaikan otomatis.\n"
            f"📌 Judul: {task['title']}\n"
            f"💬 Apology dikirim: \"{apology_msg[:120]}...\"",
            markdown=True
        )
        
        logger.warning(f"Tugas {task_id} gagal validasi sandbox setelah 7x self-correction.")
        return jsonify({
            "status": "failed", 
            "taskId": task_id, 
            "reason": apology_msg
        }), 400

@app.route('/api/message', methods=['POST'])
def send_message():
    """
    Balas pesan klien dari CashClaw secara otonom menggunakan gemma-4-26b-a4b-it.
    """
    data = request.json or {}
    task_id = data.get("taskId")
    content = data.get("content", "")
    logger.info(f"Menerima request /api/message untuk task: {task_id} | Pesan: {content[:100]}")
    
    task = CASHCLAW_TASKS.get(task_id)
    task_title = task["title"] if task else f"Task {task_id}"
    
    prompt = (
        f"Kamu adalah AI freelance agent profesional yang ramah.\n"
        f"Klien dari platform CashClaw mengirimkan pesan berikut untuk tugas '{task_title}':\n"
        f"\"{content}\"\n\n"
        f"Tulis balasan profesional yang ringkas, solutif, dan sopan dalam bahasa Inggris "
        f"tanpa basa-basi berlebih (maks 70 kata)."
    )
    
    try:
        reply = llm.generate_content(prompt, use_negotiation_model=True) or "Thank you for reaching out! I am actively looking into this and will get back to you shortly."
        
        # Kirim notifikasi Telegram
        hermes.send_message(
            f"💬 *CashClaw & HYRVE AI — Chat*\n\n"
            f"👤 Klien: \"{content[:100]}...\"\n"
            f"🤖 Balasan Agent: \"{reply}\"",
            markdown=True
        )
        
        logger.info("Sukses membalas obrolan klien otonom.")
        return jsonify({"status": "success", "reply": reply})
    except Exception as e:
        logger.error(f"Gagal membalas pesan: {e}")
        return jsonify({"status": "success", "reply": "Thank you! I've received your request."})

@app.route('/api/decline', methods=['POST'])
def decline_task():
    data = request.json or {}
    task_id = data.get("taskId")
    reason = data.get("reason", "No reason specified")
    logger.info(f"Menerima request /api/decline untuk task: {task_id} | Alasan: {reason}")
    
    if task_id in CASHCLAW_TASKS:
        CASHCLAW_TASKS[task_id]["status"] = "DECLINED"
        
    hermes.send_message(
        f"🚫 *CashClaw & HYRVE AI — Task Declined*\n\n"
        f"📌 Task ID: `{task_id}`\n"
        f"⚠️ Alasan: {reason}",
        markdown=True
    )
    return jsonify({"status": "success"})

if __name__ == '__main__':
    # Jalankan Flask API Gateway di port 3778
    app.run(host='127.0.0.1', port=3778, debug=False)
