<#
.SYNOPSIS
  Build the app image on this Windows machine and ship it to the VPS (no build on the server).
.EXAMPLE
  .\deploy\ship.ps1 -Server 1.2.3.4
  .\deploy\ship.ps1 -Server school.example.ir -Sha abc1234 -SkipBuild
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$User = "deploy",
  [string]$Sha = "",
  [string]$RemoteDir = "/srv/school",
  [switch]$SkipBuild,
  [switch]$NoDeploy
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

if (-not $Sha) { $Sha = (git rev-parse --short=12 HEAD).Trim() }
if ((git status --porcelain) -and -not $SkipBuild) {
  Write-Warning "Working tree is dirty; the image tag $Sha will not match the code exactly."
}
$image = "edu-app:$Sha"

if (-not $SkipBuild) {
  Write-Host "==> docker build $image" -ForegroundColor Cyan
  docker build --build-arg "APP_VERSION=$Sha" -t $image .
  if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
}

Write-Host "==> docker save $image | ssh $User@$Server docker load" -ForegroundColor Cyan
# Piping a binary stream through PowerShell corrupts it; run the pipeline inside cmd.exe.
cmd /c "docker save $image | ssh $User@$Server docker load"
if ($LASTEXITCODE -ne 0) { throw "image transfer failed" }

if ($NoDeploy) { Write-Host "Image loaded. Skipping deploy (-NoDeploy)."; exit 0 }

Write-Host "==> ssh $User@$Server $RemoteDir/deploy.sh $Sha" -ForegroundColor Cyan
ssh "$User@$Server" "bash $RemoteDir/deploy.sh $Sha"
if ($LASTEXITCODE -ne 0) { throw "deploy.sh failed (rollback should have run; check server logs)" }
Write-Host "==> deployed $image" -ForegroundColor Green
