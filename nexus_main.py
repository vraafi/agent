import asyncio
import os
import json
import subprocess
import requests
import aiofiles
import signal
import sys
import random
import time
from aiohttp import web
from rich.panel import Panel

from nexus_config import (
    console_terminal_interface,
    ROBLOX_UNIVERSE_ID,
    ROBLOX_PLACE_ID,
    ROBLOX_OPEN_CLOUD_API_KEY,
    PROJECT_ROOT_DIRECTORY,
    SOURCE_CODE_DIRECTORY,
    COMPILED_GAME_FILE,
    VPS_WEBHOOK_PORT,
    LIVE_JIT_MESSAGING_TOPIC,
    ACTIVE_AGENTS,
    TELEGRAM_CHAT_ID,
    TELEGRAM_BOT_TOKEN,
)
from nexus_database import (
    initialize_system_ledger,
    establish_database_connection,
    log_roblox_telemetry,
    get_unanalyzed_telemetry,
)
from nexus_compiler import NativeLuauCompiler
from nexus_agents import OmniSynthesizerAgent, AutoHealerAgent


# ==============================
# TELEGRAM RATE LIMITING SYSTEM
# ==============================
_telegram_semaphore = asyncio.Semaphore(1)  # Hanya 1 message per waktu
_last_telegram_send = 0.0  # Tracking waktu last send
_min_interval_between_messages = 2.0  # Minimal 2 detik antar message


async def send_telegram_notification(message: str, important: bool = False):
    """
    Kirim notifikasi Telegram dengan rate limiting.
    - important=True: Langsung kirim (untuk deployment success/failure)
    - important=False: Queue dengan delay 2 detik (untuk regular updates)
    """
    global _last_telegram_send
    
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        return

    async with _telegram_semaphore:
        # Rate limiting: enforce minimum interval
        now = time.time()
        elapsed = now - _last_telegram_send
        
        if not important and elapsed < _min_interval_between_messages:
            # Jika bukan important message, tunggu sampai interval tercapai
            await asyncio.sleep(_min_interval_between_messages - elapsed)
        
        _last_telegram_send = time.time()

        url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
        payload = {
            "chat_id": TELEGRAM_CHAT_ID,
            "text": message,
            "parse_mode": "HTML",
        }
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: requests.post(url, json=payload, timeout=10)
            )
        except Exception as e:
            console_terminal_interface.print(f"[dim yellow]Notifikasi Telegram gagal: {e}[/dim yellow]")


async def handle_roblox_telemetry(request):
    try:
        data = await request.json()
        await log_roblox_telemetry(
            data.get("server_id", "UNKNOWN"),
            data.get("event_type", "UNKNOWN"),
            data.get("event_data", {}),
        )
        return web.Response(text="TELEMETRY_LOGGED", status=200)
    except Exception as e:
        return web.Response(text=str(e), status=400)


async def start_telemetry_webhook():
    """Jalankan webhook server aiohttp di background."""
    app = web.Application()
    app.router.add_post("/telemetry", handle_roblox_telemetry)
    runner = web.AppRunner(app)
    await runner.setup()
    try:
        site = web.TCPSite(runner, "0.0.0.0", VPS_WEBHOOK_PORT)
        await site.start()
        console_terminal_interface.print(f"[bold cyan][Webhook] Memantau Roblox di Port {VPS_WEBHOOK_PORT}...[/bold cyan]")
    except OSError as e:
        console_terminal_interface.print(f"[bold yellow][Webhook] Port {VPS_WEBHOOK_PORT} tidak tersedia: {e}. Webhook dinonaktifkan.[/bold yellow]")


class RobloxDeployer:
    @staticmethod
    def compile_rojo() -> bool:
        console_terminal_interface.print("[bold yellow][Rojo] Mengompilasi Realitas ke .rbxl...[/bold yellow]")
        try:
            result = subprocess.run(
                ["rojo", "build", PROJECT_ROOT_DIRECTORY, "-o", COMPILED_GAME_FILE],
                capture_output=True,
                timeout=120,
            )
            if result.returncode != 0:
                console_terminal_interface.print(f"[bold yellow][Rojo] Build gagal: {result.stderr.decode(errors='ignore')[:200]}[/bold yellow]")
            return result.returncode == 0
        except FileNotFoundError:
            console_terminal_interface.print("[bold yellow][Rojo] Tidak terinstall. Tahap build dilewati.[/bold yellow]")
            return False
        except subprocess.TimeoutExpired:
            console_terminal_interface.print("[bold yellow][Rojo] Build timeout.[/bold yellow]")
            return False
        except Exception as e:
            console_terminal_interface.print(f"[bold yellow][Rojo] Error: {e}[/bold yellow]")
            return False

    @staticmethod
    async def publish():
        if not os.path.exists(COMPILED_GAME_FILE):
            console_terminal_interface.print("[bold yellow][Deploy] File .rbxl tidak ditemukan. Publish dilewati.[/bold yellow]")
            return
        if not ROBLOX_OPEN_CLOUD_API_KEY:
            console_terminal_interface.print("[bold yellow][Deploy] ROBLOX_OPEN_CLOUD_API_KEY tidak dikonfigurasi.[/bold yellow]")
            return

        url = f"https://apis.roblox.com/universes/v1/{ROBLOX_UNIVERSE_ID}/places/{ROBLOX_PLACE_ID}/versions"
        headers = {
            "x-api-key": ROBLOX_OPEN_CLOUD_API_KEY,
            "Content-Type": "application/xml",
        }
        try:
            loop = asyncio.get_event_loop()
            with open(COMPILED_GAME_FILE, "rb") as f:
                file_data = f.read()

            def _do_publish():
                return requests.post(
                    url,
                    headers=headers,
                    data=file_data,
                    params={"versionType": "Published"},
                    timeout=120,
                )

            response = await loop.run_in_executor(None, _do_publish)

            if response.status_code == 200:
                version_number = response.json().get("versionNumber", "Unknown")
                console_terminal_interface.print(f"[bold green]✅ Deployment Berhasil! (Versi {version_number})[/bold green]")
                await send_telegram_notification(f"✅ Deployment ke Roblox berhasil! Versi: {version_number}")
            else:
                msg = f"❌ Deployment Gagal! Status: {response.status_code}, Respon: {response.text[:200]}"
                console_terminal_interface.print(f"[bold red]{msg}[/bold red]")
                await send_telegram_notification(msg)
        except Exception as e:
            console_terminal_interface.print(f"[bold red][Deploy] Exception: {e}[/bold red]")


def setup_rojo():
    dirs = [
        "src/ServerScriptService",
        "src/StarterPlayer/StarterPlayerScripts",
        "src/StarterPlayer/StarterCharacterScripts",
        "src/StarterGui",
        "src/ReplicatedStorage",
    ]
    for d in dirs:
        os.makedirs(os.path.join(PROJECT_ROOT_DIRECTORY, d), exist_ok=True)

    project_config = {
        "name": "ApexAbsolut",
        "tree": {
            "$className": "DataModel",
            "ServerScriptService": {"$path": "src/ServerScriptService"},
            "StarterPlayer": {
                "StarterPlayerScripts": {"$path": "src/StarterPlayer/StarterPlayerScripts"},
            },
            "ReplicatedStorage": {"$path": "src/ReplicatedStorage"},
        },
    }
    config_path = os.path.join(PROJECT_ROOT_DIRECTORY, "default.project.json")
    with open(config_path, "w") as f:
        json.dump(project_config, f, indent=4)


async def dump_ssd():
    """Dump semua modul terverifikasi ke file di disk."""
    try:
        db = establish_database_connection()
        cur = db.cursor()
        cur.execute("SELECT filepath, code_content FROM verified_modules")
        rows = cur.fetchall()
        db.close()

        for row in rows:
            filepath = row[0]
            code_content = row[1]
            if not filepath or filepath == "memory":
                continue
            try:
                os.makedirs(os.path.dirname(filepath), exist_ok=True)
                async with aiofiles.open(filepath, "w", encoding="utf-8") as f:
                    await f.write(code_content)
            except Exception as e:
                console_terminal_interface.print(f"[bold yellow]Gagal dump {filepath}: {e}[/bold yellow]")
    except Exception as e:
        console_terminal_interface.print(f"[bold yellow]Gagal dump_ssd: {e}[/bold yellow]")


def _build_task_queue():
    """Bangun antrian tugas dinamis untuk semua modul game."""
    dynamic_tasks = [
        ("DAILY_LOG_SYSTEM", 1, "Rancang sistem log harian untuk pemain dengan batas $1,000 per hari. Gunakan mata uang Dollar ($).", [], []),
        ("LOBBY_SPACESHIP", 1, "Rancang lobby di pesawat luar angkasa besar dengan domain investor per player (mirip Arena Breakout inventory system), sistem penyimpanan mirip Arena Breakout, dan analisis/implementasi sistem luka realistis (patah tulang, bleeding, dll) seperti Arena Breakout. Gunakan mata uang Dollar ($).", [], []),
        ("FANTASY_PORTAL_DOMAIN", 1, "Rancang domain portal fantasi dengan batasan 4 pemain per domain, solo setelah 30 detik menunggu, dan batas waktu ekstraksi 2.5 jam dengan meteor wipe jika lewat. Gunakan mata uang Dollar ($).", [], []),
        ("AUDIO_SYSTEM", 1, "Rancang sistem audio untuk game, termasuk efek suara dan musik latar yang dinamis sesuai lingkungan dan kejadian. Gunakan mata uang Dollar ($).", [], []),
        ("MONSTER", 100, "Rancang monster unik untuk bioma yang berbeda. Pastikan ekosistem terhubung. Gunakan mata uang Dollar ($).", [], []),
        ("BIOME", 10, "Rancang bioma lingkungan ekstrem (Banjir, Pasir, Hutan, Gunung, dll). Gunakan mata uang Dollar ($).", [], []),
        ("ITEM", 100, "Rancang item loot unik. WAJIB tentukan dimensi Tetris (contoh: 1x2). Gunakan mata uang Dollar ($).", [], []),
        ("ARMOR_HELMET", 10, "Rancang armor dan helm unik (modern dan fantasy). WAJIB tentukan dimensi Tetris. Gunakan mata uang Dollar ($).", [], []),
        ("MODERN_WEAPON", 10, "Rancang senjata api modern Raycast. WAJIB tentukan dimensi Tetris GridWidth/GridHeight. Harga realistis sesuai dunia nyata. Gunakan mata uang Dollar ($).", ["Raycast"], []),
        ("FANTASY_WEAPON", 10, "Rancang senjata sihir/melee fantasy. WAJIB dimensi Tetris. Konsumsi Mana. Gunakan mata uang Dollar ($).", [], []),
        ("WEATHER_DISASTER", 10, "Rancang sistem cuaca dan bencana alam yang mempengaruhi bioma dan gameplay. Gunakan mata uang Dollar ($).", [], []),
        ("FURNITURE", 10, "Rancang furnitur unik untuk lobby pesawat luar angkasa. WAJIB tentukan dimensi Tetris. Gunakan mata uang Dollar ($).", [], []),
    ]

    task_queue = []
    for cat, amt, desc, req, forb in dynamic_tasks:
        for i in range(1, amt + 1):
            task_queue.append({
                "name": f"{cat}_{i}",
                "path": os.path.join(SOURCE_CODE_DIRECTORY, "ServerScriptService", f"{cat}_{i}.lua"),
                "req": req,
                "forb": forb,
                "desc": desc,
            })
    return task_queue


async def run_orchestrator():
    """
    Orchestrator utama — Sequential Queue Handoff.

    LOGIKA YANG DIPERBAIKI:
    - Setiap task diproses SATU PER SATU, bukan paralel.
    - Agent berputar (round-robin) per PERCOBAAN, bukan per task.
    - Setelah 1 percobaan selesai (sukses atau gagal), baru lanjut ke percobaan berikutnya.
    - Rate limit = global cooldown 60 detik, lalu lanjut ke agent berikutnya.
    - Tidak ada spam 15 pesan error sekaligus.
    """
    try:
        await initialize_system_ledger()
        setup_rojo()
        NativeLuauCompiler.ensure_compiler_exists()

        asyncio.create_task(start_telemetry_webhook())

        healer = AutoHealerAgent()
        synthesizer = OmniSynthesizerAgent(healer)

        evolution_level = 1
        generation_counter = 1

        # Indeks rotasi agent yang random tiap restart untuk distribusi beban
        agent_idx = random.randint(0, len(ACTIVE_AGENTS) - 1) if ACTIVE_AGENTS else 0

        while True:
            console_terminal_interface.print(
                Panel(f"[bold magenta]=== EVOLUSI LEVEL {evolution_level}/50 - SIKLUS KE-{generation_counter} ===[/bold magenta]")
            )

            task_queue = _build_task_queue()
            total_tasks = len(task_queue)

            console_terminal_interface.print(
                Panel(
                    f"[bold magenta]=== TAHAP 1: SEQUENTIAL QUEUE HANDOFF "
                    f"({total_tasks} tasks, {len(ACTIVE_AGENTS)} agents aktif) ===[/bold magenta]"
                )
            )

            tasks_done = 0
            tasks_failed = 0
            failed_tasks = []  # Batch collection untuk errors

            for task_num, task in enumerate(task_queue, start=1):
                console_terminal_interface.print(
                    f"\n[bold blue]--- Task {task_num}/{total_tasks}: {task['name']} ---[/bold blue]"
                )
                
                # PERBAIKAN: Prevent infinite retry loop
                # - Max 4 attempts per task (tidak termasuk rate limit waits)
                # - Detect recurring errors (misal "but got" 3x) → auto-skip task
                # - Exponential backoff: 2s, 4s, 8s, 16s (max 30s)

                import time
                task_start_time = time.time()
                task_timeout = 900  # 15 menit timeout per task
                completed = False
                prev_err = ""
                prev_code = ""
                real_attempt_count = 0
                max_retry_attempts = 4  # Max 4 percobaan nyata (bukan rate limit)
                error_history = []  # Track error repetition

                while not completed and (time.time() - task_start_time) < task_timeout and real_attempt_count < max_retry_attempts:
                    # Pilih agent berikutnya dalam rotasi round-robin
                    current_agent = ACTIVE_AGENTS[agent_idx % len(ACTIVE_AGENTS)]
                    agent_idx += 1

                    console_terminal_interface.print(
                        f"[bold cyan]  Percobaan {real_attempt_count + 1}/{max_retry_attempts} → [{current_agent['name']}] (waktu tersisa: {int(task_timeout - (time.time() - task_start_time))}s)[/bold cyan]"
                    )

                    try:
                        # SATU request pada satu waktu (dijamin oleh Semaphore(1) di dalam synthesize_handoff)
                        completed, prev_err, prev_code = await synthesizer.synthesize_handoff(
                            current_agent,
                            task["path"],
                            task["name"],
                            task["desc"],
                            task["req"],
                            task["forb"],
                            prev_err,
                            prev_code,
                        )
                    except Exception as e:
                        prev_err = f"EXCEPTION: {str(e)}"
                        completed = False
                        console_terminal_interface.print(
                            f"[bold red]  Exception pada task {task['name']}: {e}[/bold red]"
                        )

                    if completed:
                        tasks_done += 1
                        break  # Berhasil → lanjut ke task berikutnya

                    if "RATE_LIMIT" in prev_err:
                        console_terminal_interface.print(
                            f"[bold yellow]  Rate limit terdeteksi, menunggu 60 detik...[/bold yellow]"
                        )
                        await asyncio.sleep(60)  # Tunggu cooldown per-key
                    else:
                        real_attempt_count += 1  # Hanya count attempt jika bukan rate limit
                        
                        # DETEKSI: Error yang sama berulang berkali-kali = kemungkinan impossible task
                        error_key = prev_err.split(":")[0][:50]  # First 50 chars untuk grouping
                        error_history.append(error_key)
                        same_error_count = sum(1 for e in error_history if e == error_key)
                        
                        if same_error_count >= 3 and "but got" in prev_err:
                            console_terminal_interface.print(
                                f"[bold red]  HALT: Error '{error_key}' terulang 3x → Task terlalu kompleks/impossible, SKIP[/bold red]"
                            )
                            failed_tasks.append(f"SKIP_IMPOSSIBLE: {task['name']} (error: {error_key})")
                            break  # Skip task ini sepenuhnya
                        
                        # Exponential backoff: 2s, 4s, 8s, 16s, max 30s
                        backoff_delay = min(2 ** real_attempt_count, 30)
                        if real_attempt_count > 0:
                            console_terminal_interface.print(
                                f"[bold yellow]  Retry dengan exponential backoff ({backoff_delay:.1f}s) - Attempt {real_attempt_count}/{max_retry_attempts}...[/bold yellow]"
                            )
                            await asyncio.sleep(backoff_delay)

                if not completed:
                    # Tentukan alasan kegagalan
                    if real_attempt_count >= max_retry_attempts:
                        failure_reason = f"Max attempts ({max_retry_attempts}) reached"
                    elif (time.time() - task_start_time) >= task_timeout:
                        failure_reason = "Timeout 15 menit"
                    else:
                        failure_reason = "Unknown"
                    
                    console_terminal_interface.print(
                        f"[bold red]CRITICAL HALT: Task {task['name']} gagal due to {failure_reason}. Error: {prev_err[:150]}...[/bold red]"
                    )
                    # Lanjut ke task berikutnya meskipun gagal, sesuai permintaan awal

                    console_terminal_interface.print(
                        f"[bold yellow]  Attempts used: {real_attempt_count}/{max_retry_attempts} | Reason: {failure_reason}[/bold yellow]"
                    )

                if not completed:
                    tasks_failed += 1
                    error_summary = f"• {task['name']}: {prev_err[:100]}"
                    failed_tasks.append(error_summary)
                    console_terminal_interface.print(f"[bold red]{error_summary}[/bold red]")
                    # Jangan kirim individual notification - akan di-batch di akhir siklus
                    # Lanjutkan ke task berikutnya untuk stabilitas maksimal
                    continue

            console_terminal_interface.print(
                f"\n[bold magenta]Siklus {generation_counter} Selesai. "
                f"Berhasil: {tasks_done}/{total_tasks}, Gagal: {tasks_failed}/{total_tasks}. "
                f"Sinkronisasi File...[/bold magenta]"
            )
            await dump_ssd()

            if RobloxDeployer.compile_rojo():
                await RobloxDeployer.publish()

            # Build success message dengan batch error summary
            success_msg = (
                f"✅ Evolusi Level {evolution_level} Selesai! "
                f"({tasks_done}/{total_tasks} task berhasil)"
            )
            console_terminal_interface.print(f"[bold green]{success_msg}[/bold green]")
            await send_telegram_notification(success_msg, important=True)

            # Kirim batch error summary jika ada yang gagal
            if failed_tasks and len(failed_tasks) <= 20:
                # Jika error count reasonable, kirim detail summary
                failed_msg = f"⚠️ {tasks_failed} Task Gagal dalam Evolusi {evolution_level}:\n" + "\n".join(failed_tasks[:20])
                await send_telegram_notification(failed_msg)
            elif failed_tasks:
                # Jika terlalu banyak error, hanya summary
                failed_msg = f"⚠️ {tasks_failed} Task Gagal dalam Evolusi {evolution_level}. Periksa log untuk detail."
                await send_telegram_notification(failed_msg)

            evolution_level += 1
            generation_counter += 1

            if evolution_level > 50:
                console_terminal_interface.print("[bold green]🎉 Semua 50 Evolusi Selesai! Memulai Deployment Akhir...[/bold green]")
                await send_telegram_notification("🎉 Semua 50 Evolusi Selesai!")
                if RobloxDeployer.compile_rojo():
                    await RobloxDeployer.publish()
                break

            console_terminal_interface.print("[bold green]Menunggu siklus berikutnya (10s)...[/bold green]")
            await asyncio.sleep(10)

    except Exception as e:
        error_msg = f"FATAL ERROR di Orchestrator: {type(e).__name__}: {e}"
        console_terminal_interface.print(f"[bold red]{error_msg}[/bold red]")
        try:
            await send_telegram_notification(f"❌ {error_msg}")
        except Exception:
            pass
        raise


def _shutdown_handler(signum, frame):
    console_terminal_interface.print("[bold red]\nSistem dihentikan oleh pengguna (SIGINT/SIGTERM).[/bold red]")
    sys.exit(0)


if __name__ == "__main__":
    signal.signal(signal.SIGINT, _shutdown_handler)
    signal.signal(signal.SIGTERM, _shutdown_handler)

    console_terminal_interface.print(
        Panel("[bold cyan]NEXUS TIER ABSOLUTE APEX - SELF-HEALING AUTONOMOUS AGENT INITIALIZING...[/bold cyan]")
    )
    try:
        asyncio.run(run_orchestrator())
    except SystemExit:
        console_terminal_interface.print("[bold yellow]Sistem keluar dengan bersih.[/bold yellow]")
    except Exception as e:
        console_terminal_interface.print(f"[bold red]CRASH FATAL: {e}[/bold red]")
        sys.exit(1)
