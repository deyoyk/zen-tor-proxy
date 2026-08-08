[CmdletBinding()]
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Repo = 'deyoyk/zen-tor-proxy'
$AssetName = 'zen-tor-proxy-windows-x64.exe'
$InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\zen-tor-proxy'
$ExePath = Join-Path $InstallDir $AssetName
$ShimDir = Join-Path $env:LOCALAPPDATA 'Microsoft\WindowsApps'
$ShimPath = Join-Path $ShimDir 'zen-tor-proxy.cmd'
$VersionFile = Join-Path $InstallDir 'version.txt'

if ($Uninstall) {
  cmd.exe /c "taskkill /F /T /IM `"$AssetName`" >nul 2>&1" | Out-Null
  Start-Sleep -Milliseconds 500
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  if (Test-Path $ShimPath) { Remove-Item $ShimPath -Force }
  Write-Host 'zen-tor-proxy uninstalled.'
  exit 0
}

Write-Host "Checking for latest release of $Repo ..."
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'zen-tor-proxy-installer' }
$Tag = $Release.tag_name
$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) { throw "Asset $AssetName not found in release $Tag" }

if (Test-Path $ExePath) {
  $Installed = if (Test-Path $VersionFile) { (Get-Content $VersionFile -Raw).Trim() } else { 'unknown' }
  if ($Installed -eq $Tag) {
    Write-Host "zen-tor-proxy is already up to date ($Tag)."
    exit 0
  }
  Write-Host "Updating zen-tor-proxy $Installed -> $Tag ..."
  # Kill via cmd so a "process not found" (app not currently running) never
  # surfaces as a PowerShell error and aborts the update.
  cmd.exe /c "taskkill /F /T /IM `"$AssetName`" >nul 2>&1" | Out-Null
  Start-Sleep -Milliseconds 500
  $Tmp = Join-Path $InstallDir "$AssetName.tmp"
  Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $Tmp
  Move-Item -Force -Path $Tmp -Destination $ExePath
} else {
  Write-Host "Installing zen-tor-proxy $Tag ..."
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
  Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $ExePath
  New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null
  "@echo off", "`"$ExePath`" %*" | Set-Content -Path $ShimPath -Encoding Ascii
  if ($env:Path -split ';' -notcontains $ShimDir) {
    $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    [Environment]::SetEnvironmentVariable('Path', "$UserPath;$ShimDir", 'User')
    Write-Host "Added $ShimDir to your user PATH - open a new terminal before running."
  }
}

Set-Content -Path $VersionFile -Value $Tag -Encoding Ascii
$EnvFile = Join-Path $InstallDir '.env'
if (-not (Test-Path $EnvFile)) {
  @(
    '# zen-tor-proxy configuration (edit and restart)',
    '# Full list of options: https://github.com/deyoyk/zen-tor-proxy',
    '#',
    '#PORT=5678',
    '#LOG_LEVEL=info',
    '#LOCAL_AUTH_TOKEN=change-me'
  ) | Set-Content -Path $EnvFile -Encoding Ascii
}

Write-Host ''
Write-Host "zen-tor-proxy installed ($Tag)!"
Write-Host '  Run it in any terminal:  zen-tor-proxy'
Write-Host '  API endpoint:            http://127.0.0.1:5678/v1'
Write-Host '  Edit config:             ' + $EnvFile
Write-Host '  Log file:                ' + (Join-Path $InstallDir 'zen-tor-proxy.log')
