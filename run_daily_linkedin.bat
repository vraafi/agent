@echo off
echo ==============================================
echo Nexus DualBrain AI - Autonomous Daily LinkedIn
echo ==============================================

cd /d "C:\Users\user\.antigravity\Nexus-DualBrain-AI"

echo [*] Activating Python environment...
call venv_win\Scripts\activate.bat

echo [*] Generating Daily Post using Gemini...
python scratch\generate_daily_post.py

echo [*] Wait 5 seconds...
timeout /t 5 /nobreak >nul

echo [*] Publishing to LinkedIn via CloakBrowser CDP (Port 9223)...
python scratch\publish_linkedin_post.py

echo [*] Daily workflow completed!
pause
