@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install the LTS version from https://nodejs.org, then run this file again.
  pause
  exit /b 1
)
start "Clean by Lesa Server" /D "%~dp0" node server.js
timeout /t 2 /nobreak >nul
start "" http://localhost:3101/
echo Website: http://localhost:3101
echo Keep the Clean by Lesa Server window open.
pause
