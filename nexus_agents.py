import asyncio
import json
import re
import os
import uuid
import shutil
import signal
import tempfile
from typing import Tuple

from nexus_healer import ApexKeyRotator

from rich.progress import Progress, SpinnerColumn, TextColumn

from nexus_config import (
    console_terminal_interface,
    TEMP_IO_DIRECTORY,
    ACTIVE_AGENTS,
    APIKeyRotator,
    GEMINI_CLI_PATH,
)
from nexus_database import retrieve_ecosystem_context, save_verified_module
from nexus_compiler import AbsoluteOmniValidator, NativeLuauCompiler

# Inisialisasi per-key cooldown rotator
_key_rotator = ApexKeyRotator([a["api_key"] for a in ACTIVE_AGENTS if a["api_key"]])

# FAKTA MUTLAK: Hanya 1 request ke Gemini CLI pada satu waktu (Sequential Queue)
# Semaphore(1) memastikan agent benar-benar antri satu per satu, tidak ada spam paralel
CLI_EXECUTION_SEMAPHORE = asyncio.Semaphore(1)

# Variabel aman untuk mencegah Markdown Parser UI memecah file secara visual
MARKDOWN_BLOCK = "```"


def extract_pure_luau_code(raw_payload: str) -> str:
    """Penghancur Markdown tangguh. Membersihkan sisa backtick dan spasi liar."""
    if not raw_payload:
        return ""
    code = raw_payload.strip()
    code = re.sub(r'^\s*```[a-zA-Z]*\s*\n*', '', code, flags=re.IGNORECASE)
    code = re.sub(r'\n*\s*```\s*$', '', code)
    return code.strip()


async def execute_gemini_cli_pure(agent: dict, system_instruction: str, prompt_payload: str) -> Tuple[bool, str]:
    """
    EKSEKUTOR MUTLAK SEQUENTIAL (File-to-File IPC): 100% Native CLI Execution.
    DIPERBAIKI:
    - Semaphore(1) = hanya 1 request aktif pada satu waktu, agent benar-benar antri
    - Per-key rate-limit cooldown agar key lain tetap bekerja
    - Fallback model otomatis Gemini 3.1 -> 3 -> 2.5
    - Tidak ada stdin/stdout pipe conflict
    """
    async with CLI_EXECUTION_SEMAPHORE:
        api_key = _key_rotator.get_key()
        if not api_key:
            return False, "API_KEY_KOSONG"

        unique_session_id = uuid.uuid4().hex
        temp_home_dir = os.path.join(TEMP_IO_DIRECTORY, f"gemini_cli_home_{unique_session_id}")

        try:
            os.makedirs(temp_home_dir, exist_ok=True)
            os.makedirs(os.path.join(temp_home_dir, ".gemini"), exist_ok=True)

            prompt_filepath = os.path.join(temp_home_dir, "input_prompt.txt")
            output_filepath = os.path.join(temp_home_dir, "output_response.txt")

            env_vars = os.environ.copy()
            env_vars["GEMINI_API_KEY"] = api_key
            env_vars["CI"] = "true"
            env_vars["TERM"] = "dumb"
            env_vars["NO_COLOR"] = "1"
            env_vars["HOME"] = temp_home_dir

            schema_enforcement = '{"luau_code_payload": "string kode luau murni"}'

            full_payload = (
                f"[SYSTEM INSTRUCTION]:\n{system_instruction}\n\n"
                f"[WAJIB OUTPUT JSON MURNI SESUAI SCHEMA BERIKUT]:\n{schema_enforcement}\n\n"
                f"[PROMPT TASK]:\n{prompt_payload}"
            )

            with open(prompt_filepath, "w", encoding="utf-8") as f:
                f.write(full_payload)

            # URUTAN MODEL: Gemini 3.1 -> 3 -> 2.5 Flash
            model_candidates = [
                "models/gemini-3.1-flash-lite-preview",
                "models/gemini-3-flash-preview",
                "models/gemini-2.5-flash",
            ]

            last_error = ""
            for model_name in model_candidates:
                try:
                    with open(prompt_filepath, "r", encoding="utf-8") as f:
                        prompt_content = f.read()

                    command = [
                        GEMINI_CLI_PATH,
                        "-m", model_name,
                        "-y",
                        "-p", "Baca seluruh data instruksi dari stdin. Keluarkan JSON murni.",
                    ]

                    process = await asyncio.create_subprocess_exec(
                        *command,
                        stdin=asyncio.subprocess.PIPE,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                        env=env_vars,
                        start_new_session=True,
                    )

                    try:
                        stdout_data, stderr_data = await asyncio.wait_for(
                            process.communicate(input=prompt_content.encode("utf-8")),
                            timeout=120.0,
                        )
                    except asyncio.TimeoutError:
                        try:
                            os.killpg(os.getpgid(process.pid), signal.SIGKILL)
                        except (OSError, ProcessLookupError):
                            pass
                        try:
                            await asyncio.wait_for(process.communicate(), timeout=5.0)
                        except asyncio.TimeoutError:
                            pass
                        last_error = f"API Timeout 120s ({model_name})."
                        continue

                    if process.returncode != 0:
                        error_details = stderr_data.decode("utf-8", errors="ignore").strip().lower()
                        if "429" in error_details or "quota" in error_details or "exhausted" in error_details or "rate" in error_details:
                            # Aktifkan per-key cooldown 60 detik agar key ini berhenti, key lain lanjut
                            _key_rotator.mark_rate_limited(api_key)
                            return False, "RATE_LIMIT_REACHED"
                        last_error = f"CLI_ERROR ({model_name}): {error_details[:300]}"
                        continue

                    raw_output = stdout_data.decode("utf-8", errors="ignore")

                    with open(output_filepath, "w", encoding="utf-8") as f:
                        f.write(raw_output)

                    # LOGIKA EKSTRAKSI JSON PRESISI
                    markdown_match = re.search(r'```(?:json)?\n(.*?)\n```', raw_output, re.DOTALL | re.IGNORECASE)

                    if markdown_match:
                        clean_str = markdown_match.group(1).strip()
                        try:
                            parsed = json.loads(clean_str, strict=False)
                            code = parsed.get("luau_code_payload", "")
                            if code:
                                return True, extract_pure_luau_code(code)
                        except Exception:
                            pass

                    # Fallback: cari batas JSON langsung
                    start_idx = raw_output.find('{')
                    end_idx = raw_output.rfind('}')
                    if start_idx != -1 and end_idx != -1 and end_idx >= start_idx:
                        clean_str = raw_output[start_idx:end_idx + 1]
                        try:
                            parsed = json.loads(clean_str, strict=False)
                            code = parsed.get("luau_code_payload", "")
                            if code:
                                return True, extract_pure_luau_code(code)
                        except Exception:
                            pass

                    last_error = f"JSON_PARSE_ERROR ({model_name}): Output rusak.\nRaw: {raw_output[:200]}..."
                    continue

                except FileNotFoundError:
                    return False, f"GEMINI_CLI_NOT_FOUND: '{GEMINI_CLI_PATH}' tidak ditemukan. Pastikan gemini-cli terinstall."
                except Exception as e:
                    last_error = f"SYSTEM_EXCEPTION ({model_name}): {str(e)}"
                    continue

            return False, last_error

        finally:
            # Bersihkan direktori sementara setelah semua percobaan selesai
            if os.path.exists(temp_home_dir):
                shutil.rmtree(temp_home_dir, ignore_errors=True)


class AutoHealerAgent:
    def __init__(self):
        self.sys_inst = (
            "Anda adalah Ahli Bedah Kode Level Master. Perbaiki kode Luau yang rusak berdasarkan error dari compiler. "
            "WAJIB: SEBELUM memberikan solusi, SEARCHING di GitHub, Reddit, dan X (Twitter) forum developer untuk masalah kode yang sama. "
            "Gunakan pengetahuan dari:\n"
            "- GitHub repositories (cari 'luau' atau 'roblox' issues/PRs)\n"
            "- Reddit r/robloxdev, r/lua, r/gamedev\n"
            "- X (Twitter) @RobloxDevRel, @luau_lang, developer discussions\n"
            "STRATEGI PERBAIKAN:\n"
            "1. ANALISIS ROOT CAUSE: Baca error message carefully, pahami EXACT masalahnya (type mismatch? syntax? scope?)\n"
            "2. SURGICAL FIX: Ubah HANYA baris yang salah, jangan tulis ulang. Preserve semua logika yang sudah benar.\n"
            "3. TYPE-SAFE: Pastikan semua type annotations cocok (string vs number vs boolean vs table).\n"
            "4. ROBLOX API: Gunakan API yang VALID sesuai Roblox Developer Hub (ada di context).\n"
            "5. VALIDATION: Cek error message lagi - apakah fix ini akan resolve error?\n"
            "JANGAN PERNAH:\n"
            "- Menulis ulang kode dari awal (hanya fix yang rusak)\n"
            "- Menghapus fitur/logika yang sudah benar\n"
            "- Generate code yang ambiguous atau incomplete\n"
            "KEMBALIKAN HANYA JSON MURNI dengan key 'luau_code_payload' berisi kode perbaikan."
        )
        self.heal_history = {}  # Track healing per module untuk detect infinite loop

    def _analyze_error_type(self, error_msg: str) -> str:
        """Identify jenis error untuk targeted fix."""
        error_lower = error_msg.lower()
        
        if "but got" in error_lower or "expected" in error_lower:
            return "TYPE_MISMATCH"
        elif "unknown" in error_lower and ("global" in error_lower or "type" in error_lower):
            return "UNDEFINED_REFERENCE"
        elif "syntax" in error_lower or "unexpected symbol" in error_lower:
            return "SYNTAX_ERROR"
        elif "cannot assign" in error_lower or "function only returns" in error_lower:
            return "ASSIGNMENT_ERROR"
        elif "unknown property" in error_lower or "not found" in error_lower:
            return "PROPERTY_ERROR"
        else:
            return "GENERIC_ERROR"

    async def heal_code(
        self, 
        broken_code: str, 
        compiler_error: str, 
        module_name: str, 
        agent: dict,
        task_description: str = "",
        ecosystem_context: str = "",
        previous_error: str = ""
    ) -> str:
        """Heal broken code dengan context yang kaya."""
        last_error_line = compiler_error.splitlines()[-1] if compiler_error else "Unknown"
        error_type = self._analyze_error_type(compiler_error)
        
        # Track healing attempts
        if module_name not in self.heal_history:
            self.heal_history[module_name] = []
        heal_attempts = self.heal_history[module_name]
        heal_attempts.append(error_type)
        
        console_terminal_interface.print(
            f"[bold magenta]   [Auto-Healer] Bedah {module_name} ({error_type}): {last_error_line}[/bold magenta]"
        )
        
        safe_broken_code = extract_pure_luau_code(broken_code)
        
        # CORE FIX ANALYSIS
        fix_guidance = self._generate_fix_guidance(compiler_error, error_type)
        
        # BUILD RICH CONTEXT PROMPT
        prompt = (
            f"[TUGAS KODE INI]:\n{task_description if task_description else 'Generate resilient Luau code for Roblox game'}\n\n"
            f"[ERROR CLASSIFICATION]: {error_type}\n"
            f"[ERROR MESSAGE]:\n{compiler_error}\n\n"
            f"[RECOMMENDED FIX STRATEGY]:\n{fix_guidance}\n\n"
        )
        
        if ecosystem_context:
            prompt += f"[MODUL ECOSYSTEM REFERENCE]:\n{ecosystem_context}\n\n"
        
        prompt += (
            f"[KODE LUAU RUSAK]:\n{MARKDOWN_BLOCK}lua\n{safe_broken_code}\n{MARKDOWN_BLOCK}\n\n"
            f"[WAJIB SEARCHING SEBELUM FIX]:\n"
            f"1. GitHub: Cari 'luau {error_type}' atau 'roblox {error_type}' di issues/PRs\n"
            f"2. Reddit: r/robloxdev, r/lua untuk solutions serupa\n"
            f"3. X (Twitter): @RobloxDevRel, @luau_lang untuk updates\n"
            f"Gunakan pengetahuan dari forum developer tersebut untuk fix yang proven.\n\n"
            f"[INSTRUKSI PERBAIKAN SURGICAL]:\n"
            f"1. Identifikasi EXACT baris yang error (lihat error message)\n"
            f"2. Pahami root cause dari error type '{error_type}'\n"
            f"3. Ubah HANYA baris tersebut, minimal modification\n"
            f"4. Pastikan fix tidak introduce error baru\n"
            f"5. Validate: error message akan hilang setelah fix ini?\n\n"
            f"Output JSON MURNI dengan key 'luau_code_payload'."
        )
        
        success, result = await execute_gemini_cli_pure(agent, self.sys_inst, prompt)
        if success and result:
            return result
        return broken_code

    def _generate_fix_guidance(self, error_msg: str, error_type: str) -> str:
        """Generate targeted fix guidance berdasarkan error type."""
        base_searching = (
            "WAJIB SEARCHING SEBELUM FIX:\n"
            "- GitHub: Cari 'luau {error_type}' atau 'roblox {error_type}' di issues/PRs\n"
            "- Reddit: r/robloxdev, r/lua untuk solutions serupa\n"
            "- X (Twitter): @RobloxDevRel, @luau_lang untuk tips developer\n"
            "Gunakan implementasi proven dari forum developer tersebut.\n\n"
        )
        
        guidance = {
            "TYPE_MISMATCH": (
                base_searching +
                "TYPE MISMATCH FIX:\n"
                "- Cari 'expected X, but got Y' dalam error\n"
                "- Identifikasi variable/expression yang type-nya salah\n"
                "- Tambahkan type casting: `x as Y` atau gunakan `tostring()`, `tonumber()`, dll\n"
                "- Pastikan semua operands punya type yang compatible\n"
                "- Roblox: Vector3 * number OK, tapi string * number error → perlu tostring()"
            ),
            "UNDEFINED_REFERENCE": (
                base_searching +
                "UNDEFINED REFERENCE FIX:\n"
                "- Variable/function tidak diterima dari scope\n"
                "- Cek: apakah sudah di-require? apakah sudah di-define? apakah ada typo?\n"
                "- Untuk Roblox API: gunakan yang ada di ecosystem context\n"
                "- Jika function dari module lain, pastikan require() diatas dengan path benar"
            ),
            "SYNTAX_ERROR": (
                base_searching +
                "SYNTAX ERROR FIX:\n"
                "- Ada tanda baca/keyword yang salah atau tidak cocok\n"
                "- Cek: if/then/end, function/end, untuk kurung buka/tutup\n"
                "- Luau strict mode: semua variable harus declared dengan local/const\n"
                "- Cek: apakah ada `if` tanpa `then`? `local` tanpa assignment?"
            ),
            "ASSIGNMENT_ERROR": (
                base_searching +
                "ASSIGNMENT ERROR FIX:\n"
                "- Trying to assign ke variable yang tidak bisa di-assign\n"
                "- Atau function return value tidak sesuai expected type\n"
                "- Fix: gunakan temp variable, atau ubah type target"
            ),
            "PROPERTY_ERROR": (
                base_searching +
                "PROPERTY ERROR FIX:\n"
                "- Property/key tidak ada di table atau object\n"
                "- Cek: apakah key-nya benar? apakah table sudah di-initialize?\n"
                "- Untuk Roblox Instance: gunakan GetChildren(), FindFirstChild() dengan benar"
            ),
            "GENERIC_ERROR": (
                base_searching +
                "GENERIC ERROR FIX:\n"
                "- Bacalah error message dengan teliti, cari highlight line number\n"
                "- Check syntax dasar: kurungan, `end` keyword, type annotation\n"
                "- Gunakan dokumentasi Roblox Developer Hub untuk API yang dipakai"
            ),
        }
        return guidance.get(error_type, guidance["GENERIC_ERROR"])


class OmniSynthesizerAgent:
    def __init__(self, healer_agent: AutoHealerAgent):
        self.healer_agent = healer_agent
        self.sys_inst = (
            "Anda adalah Arsitek Penyatuan Multiverse Luau. Tulis kode Luau Murni. "
            "WAJIB: SEBELUM menulis kode, SEARCHING di GitHub, Reddit, dan X (Twitter) forum developer untuk implementasi serupa. "
            "Gunakan pengetahuan dari:\n"
            "- GitHub repositories (cari 'luau roblox' examples, issues, PRs)\n"
            "- Reddit r/robloxdev, r/lua, r/gamedev untuk best practices\n"
            "- X (Twitter) @RobloxDevRel, @luau_lang untuk updates terbaru\n"
            "Wajib --!strict. Fokus pada efisiensi matematika dan kinerja server. "
            "Sebelum menulis kode, gunakan pengetahuan dari dokumentasi Roblox Developer Hub, "
            "luau-lang.org, dan contoh kode di GitHub untuk memastikan API yang digunakan valid."
        )

    async def synthesize_handoff(
        self,
        agent: dict,
        target_filepath: str,
        module_name: str,
        task_description: str,
        req_keys: list,
        forb_keys: list,
        previous_error: str,
        previous_code: str,
    ) -> Tuple[bool, str, str]:
        comprehensive_prompt = (
            "[HUKUM ALAM SEMESTA GAME - MUTLAK]\n"
            "1. Game Ekstraksi Survival Bumi 1:1. Pemain statis tanpa Level/XP.\n"
            "2. Kekuatan eksklusif dari item: Generator Mana Level 1-9 (Kualitas Low memotong HP pemain).\n"
            "3. Ekologi & Fisika: Mesh Slicing (EditableMesh), SPH Blood, Voxel Terraforming.\n"
            "4. Akustik & Server: 150 Menit Timer, Anti-Combat Log (Alt+F4), Dungeon Master Possession.\n"
            "5. Kematian = 100% item hilang kecuali di Safe Container DataStore.\n\n"
            "[WAJIB SEARCHING SEBELUM KODE]:\n"
            "1. GitHub: Cari 'luau roblox {module_name}' atau 'roblox game development' examples\n"
            "2. Reddit: r/robloxdev, r/lua untuk best practices dan implementasi serupa\n"
            "3. X (Twitter): @RobloxDevRel, @luau_lang untuk updates dan tips terbaru\n"
            "Gunakan pengetahuan dari forum developer tersebut untuk implementasi yang proven.\n\n"
        )

        ecosystem_context = await retrieve_ecosystem_context()
        if ecosystem_context:
            comprehensive_prompt += f"[REFERENSI MODUL GLOBAL UNTUK REQUIRE()]:\n{ecosystem_context}\n\n"
        comprehensive_prompt += f"[INSTRUKSI TUGAS ({module_name})]:\n{task_description}\n\n"

        if previous_error and previous_code:
            safe_code = extract_pure_luau_code(previous_code)
            comprehensive_prompt += (
                f"[CRITICAL ERROR DARI AGEN SEBELUMNYA - PERBAIKI MATEMATIS]:\n"
                f"{MARKDOWN_BLOCK}lua\n{safe_code}\n{MARKDOWN_BLOCK}\n"
                f"[ERROR LOG]:\n{previous_error}\n\n"
                "PERBAIKI KESALAHAN INI TANPA MENGUBAH FITUR YANG SUDAH BENAR!\n"
            )

        console_terminal_interface.print(
            f"[bold cyan]  [{agent['name']}] Memproses {module_name}... (Antri Sequential)[/bold cyan]"
        )
        success, result_data = await execute_gemini_cli_pure(agent, self.sys_inst, comprehensive_prompt)

        if success:
            code_attempt = result_data

            is_valid_omni, omni_msg = AbsoluteOmniValidator.execute_validation(code_attempt, req_keys, forb_keys)
            if not is_valid_omni:
                code_attempt = await self.healer_agent.heal_code(
                    code_attempt, 
                    omni_msg, 
                    module_name, 
                    agent,
                    task_description=task_description,
                    ecosystem_context=ecosystem_context
                )
                is_valid_omni, omni_msg = AbsoluteOmniValidator.execute_validation(code_attempt, req_keys, forb_keys)
                if not is_valid_omni:
                    return False, f"Omni-Linter: {omni_msg}", code_attempt

            is_valid_ast, compile_msg = await NativeLuauCompiler.execute_native_ast_verification(code_attempt, module_name)
            if not is_valid_ast:
                code_attempt = await self.healer_agent.heal_code(
                    code_attempt, 
                    compile_msg, 
                    module_name, 
                    agent,
                    task_description=task_description,
                    ecosystem_context=ecosystem_context
                )
                is_valid_ast, compile_msg = await NativeLuauCompiler.execute_native_ast_verification(code_attempt, module_name)
                if not is_valid_ast:
                    return False, f"Native Compiler: {compile_msg}", code_attempt

            hash_val = await save_verified_module(module_name, target_filepath, code_attempt)
            console_terminal_interface.print(
                f"[bold green]✅ [{agent['name']}] Node {module_name} Lulus. Hash: {hash_val[:8]}[/bold green]"
            )
            return True, "", code_attempt
        else:
            if "RATE_LIMIT" in result_data:
                console_terminal_interface.print(
                    f"[bold yellow][{agent['name']}] Rate limit terdeteksi. Per-key cooldown aktif, akan dilanjutkan...[/bold yellow]"
                )
                # Cooldown sudah diset di dalam execute_gemini_cli_pure, tidak perlu sleep lagi di sini
            return False, result_data, previous_code
