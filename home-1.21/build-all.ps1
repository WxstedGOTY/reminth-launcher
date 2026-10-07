# Builds every Reminth home screen jar for the older Minecraft versions into build-all/ (Windows PowerShell).
# One row per jar: Minecraft version it is built against, its Fabric API, the compat family
# (compat/<family>), the version range the jar accepts, and the name suffix.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$jars = @(
  @{ mc = "1.20.1";  api = "0.92.12+1.20.1";  compat = "P"; range = "1.20.1";           name = "1.20.1"; java = "17" },
  @{ mc = "1.21.1";  api = "0.116.17+1.21.1"; compat = "Q"; range = ">=1.21 <=1.21.1"; name = "1.21-1.21.1" },
  @{ mc = "1.21.4";  api = "0.119.4+1.21.4";  compat = "R"; range = "1.21.4";           name = "1.21.4" },
  @{ mc = "1.21.5";  api = "0.128.2+1.21.5";  compat = "R"; range = "1.21.5";           name = "1.21.5" },
  @{ mc = "1.21.8";  api = "0.136.1+1.21.8";  compat = "S"; range = ">=1.21.6 <=1.21.8"; name = "1.21.6-1.21.8" },
  @{ mc = "1.21.10"; api = "0.138.4+1.21.10"; compat = "T"; range = ">=1.21.9 <=1.21.10"; name = "1.21.9-1.21.10" },
  @{ mc = "1.21.11"; api = "0.141.6+1.21.11"; compat = "U"; range = "1.21.11";          name = "1.21.11" }
)
$version = "1.0.5"
New-Item -ItemType Directory -Force build-all | Out-Null
foreach ($j in $jars) {
  & .\gradlew.bat build -q "-Pminecraft_version=$($j.mc)" "-Pfabric_api_version=$($j.api)" "-Pversion=$version+$($j.name)" "-Pcompat=$($j.compat)" "-Pmc_range=$($j.range)" "-Pjava_release=$(if ($j.java) { $j.java } else { 21 })"
  if ($LASTEXITCODE -ne 0) { throw "build failed for $($j.mc)" }
  Copy-Item "build\libs\reminthhome-$version+$($j.name).jar" build-all\ -Force
  Write-Host "built reminthhome-$version+$($j.name).jar"
}
