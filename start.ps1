param([string]$BindAddress = '0.0.0.0')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$atlasPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $atlasPython)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear el entorno virtual.' }
    & $atlasPython -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias.' }
}
$env:ANATOMY_DEV = '1'
Write-Host 'Atlas: http://127.0.0.1:8000 · guarda archivos para ver los cambios'
if ($BindAddress -eq '0.0.0.0') {
    Write-Host 'Tablet: misma Wi-Fi, abre http://IP_DE_ESTE_PC:8000'
}
& $atlasPython -m uvicorn backend.main:app --reload --reload-dir backend --host $BindAddress --port 8000
