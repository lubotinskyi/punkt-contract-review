@echo off
cd /d "%~dp0"
powershell -NoProfile -Command "try { $r=Invoke-RestMethod http://127.0.0.1:8000/api/bootstrap -TimeoutSec 2; if ($r.version -eq '1.0.0' -and $r.csrf) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  start "" http://127.0.0.1:8000
  exit /b
)
if not exist ".venv\Scripts\python.exe" (
  if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
    "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m venv .venv
  ) else (
    py -3.12 -m venv .venv
  )
  if errorlevel 1 goto error
  .venv\Scripts\python.exe -m pip install -r requirements-lock.txt
  if errorlevel 1 goto error
)
echo Open http://127.0.0.1:8000 in your browser.
start "" http://127.0.0.1:8000
.venv\Scripts\python.exe run.py
pause
exit /b
:error
echo Setup failed. Install Python 3.12 and try again.
pause
exit /b 1
