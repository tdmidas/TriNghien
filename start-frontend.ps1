# Start the AI Researcher frontend (Vite dev server on :5173, proxies /api -> :8000)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
Set-Location (Join-Path $root "frontend")
if (-not (Test-Path (Join-Path $root "frontend\node_modules"))) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}
Write-Host "Starting frontend on http://localhost:5173 ..." -ForegroundColor Green
npm run dev
