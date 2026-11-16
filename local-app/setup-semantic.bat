@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-semantic.txt
if errorlevel 1 goto error
set CONTRACT_SEMANTIC_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
echo First search downloads the embedding model. Later searches run locally.
.venv\Scripts\python.exe run.py
pause
exit /b
:error
echo Semantic dependencies installation failed.
pause
exit /b 1
