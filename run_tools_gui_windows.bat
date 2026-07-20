@echo off
setlocal

cd /d "%~dp0"

where py >nul 2>nul
if not errorlevel 1 (
  py -3 tools_gui.py
  exit /b %errorlevel%
)

python tools_gui.py
