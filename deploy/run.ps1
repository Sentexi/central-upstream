$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $AppDir

if (Test-Path ".env") {
  Get-Content ".env" | ForEach-Object {
    if ($_ -match "^\s*#") { return }
    if ($_ -match "^\s*$") { return }
    $kv = $_.Split("=",2)
    if ($kv.Length -eq 2) {
      [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim())
    }
  }
}

$Python = $env:PYTHON_BIN
if (-not $Python) { $Python = "python" }

if (-not (Test-Path ".venv")) {
  & $Python -m venv .venv
}

& .\.venv\Scripts\python.exe -m pip install -U pip
& .\.venv\Scripts\python.exe -m pip install --no-cache-dir .\wheels\*.whl

$Port = $env:PORT
if (-not $Port) { $Port = "8000" }

$env:PYTHONPATH = $AppDir

$Timeout = $env:GUNICORN_TIMEOUT
if (-not $Timeout) { $Timeout = "600" }

& .\.venv\Scripts\gunicorn.exe -w 2 -k gthread --timeout $Timeout -b "0.0.0.0:$Port" "backend.app:create_app()"
