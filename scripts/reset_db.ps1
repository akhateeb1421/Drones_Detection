# Drops + recreates the schema and re-seeds historical + synthetic data.
# Run from the repo root:
#   .\scripts\reset_db.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location "$repo\backend"

if (-not (Test-Path .\.venv)) {
    python -m venv .venv
}
.\.venv\Scripts\Activate.ps1
pip install -e . | Out-Null

Write-Host "Downgrading + upgrading Alembic..."
alembic downgrade base
alembic upgrade head

Write-Host "Loading historical CSV..."
python -m seed.load_history_csv

Write-Host "Generating synthetic dataset..."
python -m seed.generate_synthetic --n 3000 --seed 42

Write-Host "Done. Use 'uvicorn app.main:app --reload --port 8000' to start the backend."
