@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
    echo Virtual environment missing. Run setup.bat first.
    pause
    exit /b 1
)
echo Starting LVFR EMS Operations...
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8000
