# Builds every bundled mod jar after the Spaceport rename: HUD 1.6.1 and home screen 1.0.10, 10 jars each.
# Output: %TEMP%spaceport-mod-jars. Low priority so the PC stays responsive.
$ErrorActionPreference = "Stop"
$repo = "C:\Users\kolijos\Downloads\reminth-launcher"
$out = Join-Path $env:TEMP "spaceport-mod-jars"
New-Item -ItemType Directory -Force $out | Out-Null
try { (Get-Process -Id $PID).PriorityClass = "BelowNormal" } catch {}
$hud = "1.6.1"; $homeV = "1.0.10"

function Build($dir, $args2, $jar) {
  Push-Location $dir
  try {
    & .\gradlew.bat build -q @args2
    if ($LASTEXITCODE -ne 0) { throw "build failed: $dir $($args2 -join ' ')" }
    Copy-Item "build\libs\$jar" $out -Force
    Write-Host "built $jar"
  } finally { Pop-Location }
}

# HUD, 26.x (hud/: compat A = 26.2, B = 26.3, C = 26.1)
Build "$repo\hud" @("-Pcompat=A", "-Pminecraft_version=26.2", "-Pfabric_api_version=0.159.0+26.2", "-Pversion=$hud+26.2") "reminthhud-$hud+26.2.jar"
Build "$repo\hud" @("-Pcompat=B", "-Pminecraft_version=26.3", "-Pfabric_api_version=0.161.0+26.3", "-Pversion=$hud+26.3") "reminthhud-$hud+26.3.jar"
Build "$repo\hud" @("-Pcompat=C", "-Pminecraft_version=26.1", "-Pfabric_api_version=0.145.1+26.1", "-Pversion=$hud+26.1", "-Pmc_range=~26.1") "reminthhud-$hud+26.1.jar"
# Home screen, 26.x
Build "$repo\home" @("-Pcompat=A", "-Pminecraft_version=26.2", "-Pversion=$homeV+26.2") "reminthhome-$homeV+26.2.jar"
Build "$repo\home" @("-Pcompat=B", "-Pminecraft_version=26.3", "-Pversion=$homeV+26.3") "reminthhome-$homeV+26.3.jar"
Build "$repo\home" @("-Pcompat=C", "-Pminecraft_version=26.1", "-Pversion=$homeV+26.1", "-Pmc_range=~26.1") "reminthhome-$homeV+26.1.jar"
# Older versions: their own scripts (versions bumped in them)
foreach ($d in @("hud-1.21", "home-1.21")) {
  Push-Location "$repo\$d"
  try {
    & powershell -NoProfile -ExecutionPolicy Bypass -File .\build-all.ps1
    if ($LASTEXITCODE -ne 0) { throw "build-all failed in $d" }
    Copy-Item "build-all\*-$(if ($d -eq 'hud-1.21') { $hud } else { $homeV })+*.jar" $out -Force
  } finally { Pop-Location }
}
Write-Host "ALL BUILT"
Get-ChildItem $out | Select-Object Name, Length | Format-Table -AutoSize | Out-String | Write-Host
