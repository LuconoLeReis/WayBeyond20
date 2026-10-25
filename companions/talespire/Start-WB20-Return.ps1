param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$SymbioteDirectory = (Join-Path $env:USERPROFILE 'AppData\LocalLow\BouncyRock Entertainment\TaleSpire\Symbiotes\WayBeyond20')
)
$ErrorActionPreference='Stop'
$nodeExecutable=(Get-Command node -ErrorAction Stop).Source
$helperPath=Join-Path $PSScriptRoot 'local-bridge.cjs'
if (!(Test-Path -LiteralPath (Join-Path $SymbioteDirectory 'manifest.json'))) { throw 'Install the WayBeyond20 Symbiote first.' }
if (Get-NetTCPConnection -State Listen -LocalPort 48874 -ErrorAction SilentlyContinue) { throw 'Port 48874 is in use. Do not start a second helper.' }
$process=Start-Process -FilePath $nodeExecutable -ArgumentList @('"'+$helperPath+'"',$ExtensionId,'"'+$SymbioteDirectory+'"') -WindowStyle Hidden -PassThru
Write-Output "WB20 local return helper started (process $($process.Id)). Close it with Stop-Process -Id $($process.Id) when finished. It listens only on this computer."
