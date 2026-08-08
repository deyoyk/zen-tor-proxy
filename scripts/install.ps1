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

if ($Uninstall) {
  if (Test-Path $InstallDir) { Remove-Item $InstallDir -Recurse -Force }
  if (Test-Path $ShimPath) { Remove-Item $ShimPath -Force }
  Write-Host 'zen-tor-proxy uninstalled.'
  exit 0
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host "Downloading $AssetName ..."
$Release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -Headers @{ 'User-Agent' = 'zen-tor-proxy-installer' }
$Asset = $Release.assets | Where-Object { $_.name -eq $AssetName } | Select-Object -First 1
if (-not $Asset) { throw "Asset $AssetName not found in release $($Release.tag_name)" }
Invoke-WebRequest -Uri $Asset.browser_download_url -OutFile $ExePath

New-Item -ItemType Directory -Force -Path $ShimDir | Out-Null
"@echo off", "`"$ExePath`" %*" | Set-Content -Path $ShimPath -Encoding Ascii

if ($env:Path -split ';' -notcontains $ShimDir) {
  $UserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  [Environment]::SetEnvironmentVariable('Path', "$UserPath;$ShimDir", 'User')
  Write-Host "Added $ShimDir to your user PATH - open a new terminal before running."
}

Write-Host ''
Write-Host 'zen-tor-proxy installed!'
Write-Host '  Run it in any terminal:  zen-tor-proxy'
Write-Host '  API endpoint:            http://127.0.0.1:5678/v1'
