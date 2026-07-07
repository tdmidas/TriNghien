# Start the AI Researcher backend (FastAPI on :8000)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$venvPy = Join-Path $root "backend\.venv\Scripts\python.exe"

if (-not (Test-Path $venvPy)) {
    Write-Host "Creating backend venv..." -ForegroundColor Yellow
    # Use a real Windows Python (the py launcher), NOT an MSYS2/mingw python.
    py -3 -m venv (Join-Path $root "backend\.venv")
    & $venvPy -m pip install --upgrade pip
    & $venvPy -m pip install -r (Join-Path $root "backend\requirements.txt")
}

Write-Host "Starting backend on http://127.0.0.1:8000 ..." -ForegroundColor Green
Set-Location (Join-Path $root "backend")
& $venvPy -m uvicorn app.main:app --port 8000 --reload
