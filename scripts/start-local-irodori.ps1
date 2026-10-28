$ErrorActionPreference = 'Stop'
$airiRoot = Split-Path -Parent $PSScriptRoot
$irodoriRoot = Join-Path (Split-Path -Parent $airiRoot) 'Irodori-TTS-Server'
$healthUrl = 'http://127.0.0.1:8088/health'

function Get-IrodoriHealth {
    try {
        Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
    }
    catch {
        $null
    }
}

$health = Get-IrodoriHealth
if ($health -and $health.model.id -ne 'irodori-tts') {
    throw 'Port 8088 belongs to a different service.'
}

if (-not $health) {
    $irodoriPython = Join-Path $irodoriRoot '.venv\Scripts\python.exe'
    if (-not (Test-Path -LiteralPath $irodoriPython)) {
        throw 'The existing Irodori Python environment is missing.'
    }
    $runtimeDir = Join-Path $airiRoot '.local-runtime'
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    $env:MIOPEN_FIND_MODE = 'FAST'
    $env:IRODORI_PRELOAD = 'true'
    $serverProcess = Start-Process -FilePath $irodoriPython `
        -ArgumentList '-m', 'irodori_openai_tts', '--host', '127.0.0.1', '--port', '8088' `
        -WorkingDirectory $irodoriRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeDir 'irodori.stdout.log') `
        -RedirectStandardError (Join-Path $runtimeDir 'irodori.stderr.log')
    Set-Content -LiteralPath (Join-Path $runtimeDir 'irodori.pid') -Value $serverProcess.Id
    Write-Host 'Loading the local Irodori model...'
}

$loadDeadline = [DateTime]::UtcNow.AddSeconds(360)
while ([DateTime]::UtcNow -lt $loadDeadline) {
    $health = Get-IrodoriHealth
    if ($health -and $health.model.id -eq 'irodori-tts' -and $health.runtime.loaded) {
        Write-Host 'Irodori is ready at http://127.0.0.1:8088/v1/.'
        return
    }
    Start-Sleep -Seconds 2
}
throw 'Irodori did not load within 360 seconds. Read .local-runtime/irodori.stderr.log.'
