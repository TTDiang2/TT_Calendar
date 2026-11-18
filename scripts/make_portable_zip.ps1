param(
    [Parameter(Mandatory = $true)][string]$Version,
    [string]$Root = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"

$appExe = Join-Path $Root "frontend\src-tauri\target\release\TT Calendar.exe"
if (-not (Test-Path $appExe)) {
    $appExe = Join-Path $Root "frontend\src-tauri\target\release\app.exe"
}
$backendDir = Join-Path $Root "dist\tt-calendar-backend"
$out = Join-Path $Root "release\TT-Calendar-Portable-$Version.zip"
$stage = Join-Path $env:TEMP "tt-calendar-portable-$Version"

if (-not (Test-Path $appExe)) { throw "missing $appExe" }
if (-not (Test-Path $backendDir)) { throw "missing $backendDir" }

Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null

Copy-Item $appExe (Join-Path $stage "TT Calendar.exe")
Copy-Item -Recurse $backendDir (Join-Path $stage "backend")
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $out -Force
Remove-Item -Recurse -Force $stage -ErrorAction SilentlyContinue

Write-Host "portable zip: $out"
