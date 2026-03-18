param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env.local"
$exampleFile = Join-Path $projectRoot ".env.example"
$launchCommand = "Set-Location '$projectRoot'; `$env:PORT='$Port'; npm run dev"

if (-not (Test-Path $envFile) -and (Test-Path $exampleFile)) {
  Copy-Item $exampleFile $envFile
  Write-Host "Created .env.local from .env.example. Add your AWS keys there if you want live S3 access." -ForegroundColor Yellow
}

if (-not (Test-Path (Join-Path $projectRoot "node_modules"))) {
  Write-Host "Installing npm dependencies..." -ForegroundColor Cyan
  Set-Location $projectRoot
  npm install
}

Write-Host "Starting local dashboard on http://localhost:$Port" -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", $launchCommand | Out-Null

Start-Sleep -Seconds 5
Start-Process "http://localhost:$Port"
