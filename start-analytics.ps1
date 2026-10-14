$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$trafficPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
$trafficArtifacts = Join-Path $PSScriptRoot 'artifacts'
New-Item -ItemType Directory -Force -Path $trafficArtifacts | Out-Null
try { $trafficHealth = Invoke-RestMethod 'http://127.0.0.1:8011/health' -TimeoutSec 2 } catch { $trafficHealth = $null }
if ($trafficHealth -and $trafficHealth.service -ne 'atlas-traffic') { throw 'El puerto 8011 pertenece a otro servicio.' }
if (-not $trafficHealth) {
    $env:ATLAS_ANALYTICS_TRUST_PROXY = '1'
    Start-Process -FilePath $trafficPython -ArgumentList @('-m','uvicorn','backend.analytics:app','--host','127.0.0.1','--port','8011','--no-proxy-headers','--no-access-log') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $trafficArtifacts 'traffic-server.log') -RedirectStandardError (Join-Path $trafficArtifacts 'traffic-server-error.log') | Out-Null
    for ($trafficAttempt=0; $trafficAttempt -lt 30; $trafficAttempt++) {
        Start-Sleep -Milliseconds 200
        try { $trafficHealth = Invoke-RestMethod 'http://127.0.0.1:8011/health' -TimeoutSec 1; break } catch {}
    }
    if (-not $trafficHealth) { throw 'No se pudo iniciar el servicio de tráfico.' }
}
try { $trafficTunnels = (Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2).tunnels } catch { $trafficTunnels = @() }
$trafficTunnel = $trafficTunnels | Where-Object { $_.config.addr -eq 'http://127.0.0.1:8011' -and $_.public_url.StartsWith('https://') } | Select-Object -First 1
if (-not $trafficTunnel) {
    if ($trafficTunnels.Count -gt 0) { throw 'Hay otro túnel ngrok activo. No se modificó.' }
    $trafficPolicy = Join-Path $PSScriptRoot 'tools/analytics-policy.json'
    Start-Process -FilePath (Get-Command ngrok).Source -ArgumentList @('http','127.0.0.1:8011','--inspect=false','--traffic-policy-file',('"'+$trafficPolicy+'"'),'--log=stdout','--log-format=json') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $trafficArtifacts 'traffic-tunnel.log') -RedirectStandardError (Join-Path $trafficArtifacts 'traffic-tunnel-error.log') | Out-Null
    for ($trafficAttempt=0; $trafficAttempt -lt 40; $trafficAttempt++) {
        Start-Sleep -Milliseconds 250
        try { $trafficTunnel = (Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 1).tunnels | Where-Object { $_.config.addr -eq 'http://127.0.0.1:8011' -and $_.public_url.StartsWith('https://') } | Select-Object -First 1; if ($trafficTunnel) { break } } catch {}
    }
    if (-not $trafficTunnel) { throw 'No se pudo abrir el túnel HTTPS. Revisa artifacts/traffic-tunnel-error.log.' }
}
$trafficConfig = @{enabled=$true; endpoint=$trafficTunnel.public_url.TrimEnd('/')+'/collect'} | ConvertTo-Json -Compress
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'static/analytics-config.json'),$trafficConfig,[Text.UTF8Encoding]::new($false))
Write-Host 'Panel privado local: http://127.0.0.1:8011/admin'
Write-Host ('Panel con clave: '+$trafficTunnel.public_url+'/admin')
Write-Host 'Clave privada: data/private/admin-token.txt (nunca la subas a GitHub).'
Write-Host 'Mantén encendido este PC para recibir visitas. Si cambia la URL, publica de nuevo analytics-config.json.'
