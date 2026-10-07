<#
.SYNOPSIS
  Build the app image on this Windows machine and ship it to the VPS (no build on the server).
.DESCRIPTION
  -Mode registry (default): push only the layers the server does not have yet to the private registry on the VPS
  (deploy/registry.compose.yml, bound to the server's 127.0.0.1:5000), then the server pulls and retags edu-app:<sha>.
  Path of a push: Docker Desktop daemon -> localhost:<RegistryPort> (a throw-away relay container, because the
  Docker Desktop VM's "localhost" is not Windows' localhost) -> host.docker.internal:<TunnelPort> (an ssh -L tunnel
  this script starts and stops) -> 127.0.0.1:5000 on the server. localhost / 127.0.0.0/8 are insecure-allowed
  registries by default on both daemons, so no daemon.json / Docker Desktop setting changes.
  -Mode save: the old fallback, streams the whole image with docker save | ssh docker load.
.EXAMPLE
  .\deploy\ship.ps1                              # donino-vps alias, build HEAD, registry push, deploy.sh
  .\deploy\ship.ps1 -Sha abc1234 -SkipBuild -NoDeploy
  .\deploy\ship.ps1 -Server 1.2.3.4 -Mode save
#>
param(
  [string]$Server = "donino-vps",
  [string]$User = "deploy",
  [string]$Sha = "",
  [string]$RemoteDir = "/srv/school",
  [ValidateSet("registry", "save")][string]$Mode = "registry",
  [int]$RegistryPort = 5000,   # laptop side: the relay container's published port (the name localhost:<port>/...)
  [int]$TunnelPort = 5001,     # laptop side: the ssh -L listener the relay forwards to
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
$target = "$User@$Server"

if (-not $SkipBuild) {
  Write-Host "==> docker build $image" -ForegroundColor Cyan
  docker build --build-arg "APP_VERSION=$Sha" -t $image .
  if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
}

function Push-ViaRegistry {
  $relay = "edu-registry-relay"
  $localRef = "localhost:${RegistryPort}/edu-app:$Sha"
  $remoteRef = "127.0.0.1:5000/edu-app:$Sha"
  $tunnel = $null
  try {
    Write-Host "==> ssh tunnel 127.0.0.1:$TunnelPort -> ${Server}:127.0.0.1:5000" -ForegroundColor Cyan
    $tunnel = Start-Process -FilePath "ssh" -PassThru -WindowStyle Hidden -ArgumentList @(
      "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=20",
      "-L", "127.0.0.1:${TunnelPort}:127.0.0.1:5000", $target)

    # cmd: a missing container writes to stderr, which PowerShell 5.1 turns into a terminating error.
    cmd /c "docker rm -f $relay >nul 2>&1"
    docker run -d --rm --name $relay -p "127.0.0.1:${RegistryPort}:5000" -e "TP=$TunnelPort" --entrypoint node `
      node:22-bookworm-slim -e "const n=require('net');n.createServer(c=>{const s=n.connect(+process.env.TP,'host.docker.internal');c.pipe(s).pipe(c);c.on('error',()=>s.destroy());s.on('error',()=>c.destroy())}).listen(5000)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "could not start the relay container (is port $RegistryPort free?)" }

    $ready = $false
    for ($i = 0; $i -lt 30 -and -not $ready; $i++) {
      if ($tunnel.HasExited) { throw "ssh tunnel exited (port $TunnelPort in use, or ssh to $target failed)" }
      try {
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 "http://127.0.0.1:${RegistryPort}/v2/" | Out-Null
        $ready = $true
      } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) {
      throw "registry not reachable through the tunnel. On the server: docker compose -f $RemoteDir/registry.compose.yml up -d"
    }

    Write-Host "==> docker push $localRef (only layers the registry lacks)" -ForegroundColor Cyan
    docker tag $image $localRef
    if ($LASTEXITCODE -ne 0) { throw "docker tag failed (is $image built?)" }
    docker push $localRef
    $pushExit = $LASTEXITCODE
    docker rmi $localRef | Out-Null   # untag only; edu-app:<sha> stays
    if ($pushExit -ne 0) { throw "docker push failed" }
  } finally {
    cmd /c "docker rm -f $relay >nul 2>&1"
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
  }

  Write-Host "==> ssh $target docker pull $remoteRef -> $image" -ForegroundColor Cyan
  ssh $target "docker pull $remoteRef && docker tag $remoteRef $image && docker rmi $remoteRef >/dev/null"
  if ($LASTEXITCODE -ne 0) { throw "remote pull failed" }
}

if ($Mode -eq "registry") {
  Push-ViaRegistry
} else {
  Write-Host "==> docker save $image | ssh $target docker load" -ForegroundColor Cyan
  # Piping a binary stream through PowerShell corrupts it; run the pipeline inside cmd.exe.
  cmd /c "docker save $image | ssh $target docker load"
  if ($LASTEXITCODE -ne 0) { throw "image transfer failed" }
}

if ($NoDeploy) { Write-Host "Image $image is on the server. Skipping deploy (-NoDeploy)."; exit 0 }

Write-Host "==> ssh $target $RemoteDir/deploy.sh $Sha" -ForegroundColor Cyan
# nohup: a dropped ssh link must not kill deploy.sh between «point .env at the new image» and «up -d app» (2026-10-07:
# it did). cmd /c: compose writes progress to stderr, which PowerShell 5.1 with ErrorActionPreference=Stop turns into
# a terminating NativeCommandError mid-deploy. The log is printed at the end and kept in $RemoteDir/deploy-<sha>.log.
cmd /c "ssh $target ""cd $RemoteDir && nohup bash deploy.sh $Sha > deploy-$Sha.log 2>&1; rc=`$?; cat deploy-$Sha.log; exit `$rc"" 2>&1"
if ($LASTEXITCODE -ne 0) { throw "deploy.sh failed (rollback should have run; check server logs)" }
Write-Host "==> deployed $image" -ForegroundColor Green
