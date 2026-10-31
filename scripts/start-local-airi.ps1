param([switch]$SkipBuild)

$ErrorActionPreference = 'Stop'
$airiRoot = Split-Path -Parent $PSScriptRoot
$airiNodeDir = Join-Path $airiRoot '.local-tools\node-v26.7.0-win-x64'
if (-not (Test-Path -LiteralPath (Join-Path $airiNodeDir 'node.exe'))) {
    throw 'The project-local Node.js runtime is missing.'
}
$env:PATH = $airiNodeDir + ';' + $env:PATH
$env:COREPACK_HOME = Join-Path $airiRoot '.local-tools\corepack'
Set-Location -LiteralPath $airiRoot
$env:APP_USER_DATA_PATH = Join-Path $airiRoot '.local-runtime\profile'
if (-not $SkipBuild) {
    Write-Host 'Building the current AIRI source...'
    pnpm -F @proj-airi/i18n build
    if ($LASTEXITCODE -ne 0) {
        throw 'The AIRI translations did not build.'
    }
    pnpm -F @proj-airi/stage-tamagotchi build
    if ($LASTEXITCODE -ne 0) {
        throw 'AIRI did not build. The previous app will not start.'
    }
}
try {
    & (Join-Path $PSScriptRoot 'start-local-irodori.ps1')
    pnpm -F @proj-airi/stage-tamagotchi start
    if ($LASTEXITCODE -ne 0) {
        throw 'AIRI did not start. Read the command output.'
    }
}
finally {
    $ttsPidFile = Join-Path $airiRoot '.local-runtime\irodori.pid'
    if (Test-Path -LiteralPath $ttsPidFile) {
        try {
            $ttsProcessId = [int](Get-Content -LiteralPath $ttsPidFile)
            $ttsProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $ttsProcessId"
            if ($ttsProcess.CommandLine -match '-m\s+irodori_openai_tts\s' -and
                $ttsProcess.CommandLine -match '--port\s+8088(?:\s|$)') {
                taskkill /PID $ttsProcessId /T /F | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    Write-Warning 'Irodori did not stop. Check the server process.'
                }
            }
        }
        catch {
            Write-Warning "Cannot stop Irodori: $($_.Exception.Message)"
        }
    }
}
