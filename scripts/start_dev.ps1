# Boots backend + frontend in two PowerShell windows for local development.
# Usage:
#   cd capstone
#   .\scripts\start_dev.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

Write-Host "Repo: $repo"

Write-Host "`nLaunching backend in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$repo\backend'; if (-not (Test-Path .\.venv)) { python -m venv .venv }; .\.venv\Scripts\Activate.ps1; pip install -e . | Out-Null; uvicorn app.main:app --reload --port 8000"

Write-Host "Launching frontend in a new window..."
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$repo\frontend'; if (-not (Test-Path .\node_modules)) { npm install }; npm run dev"

Write-Host "`nBackend  -> http://localhost:8000  (docs: /docs)"
Write-Host "Frontend -> http://localhost:5173"
Write-Host "Open the frontend URL in your browser when it finishes booting."
