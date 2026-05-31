import subprocess
log_entry = '### [Visual Bridge] 2026-05-29\n- **Target**: Testing WSL Injection\n'
wsl_cmd = f'mkdir -p ~/.hermes/memory && cat << "EOF" >> ~/.hermes/memory/outreach_logs.md\n{log_entry}\nEOF'
result = subprocess.run(['wsl', 'bash', '-c', wsl_cmd], capture_output=True, text=True)
print('STDOUT:', result.stdout)
print('STDERR:', result.stderr)
