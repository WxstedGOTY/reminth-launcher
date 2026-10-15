# Copies the small files Home's stats read from the real Reminth into the live preview's own data, once (live.cmd).
# Never writes to the real folder. Worlds are NOT copied (only each world's level.dat and stats), so it stays small.
param([string]$Real, [string]$Fake)
$ErrorActionPreference = "SilentlyContinue"
$realGame = Join-Path $Real "instance\game"
$fakeGame = Join-Path $Fake "instance\game"
New-Item -ItemType Directory -Force $fakeGame | Out-Null
Copy-Item (Join-Path $Real "settings.json") (Join-Path $Fake "settings.json")
# streamer mode off in the preview: it would record the screen a second time
$sf = Join-Path $Fake "settings.json"; try { $j = Get-Content $sf -Raw | ConvertFrom-Json; $j.streamerMode = $false; [IO.File]::WriteAllText($sf, ($j | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding $false)) } catch {}
foreach ($f in "servers.dat", "options.txt") { Copy-Item (Join-Path $realGame $f) (Join-Path $fakeGame $f) }
# the newest game logs: Quick join reads from them when you last joined each server
$logs = Join-Path $fakeGame "logs"; New-Item -ItemType Directory -Force $logs | Out-Null
Get-ChildItem (Join-Path $realGame "logs") -File | Where-Object { $_.Name -eq "latest.log" -or $_.Name -match '^\d{4}-\d{2}-\d{2}-\d+\.log\.gz$' } | Sort-Object LastWriteTime -Descending | Select-Object -First 12 | ForEach-Object { Copy-Item $_.FullName $logs }
$ss = Join-Path $realGame ".reminth\server-stats"
if (Test-Path $ss) { New-Item -ItemType Directory -Force (Join-Path $fakeGame ".reminth") | Out-Null; Copy-Item $ss (Join-Path $fakeGame ".reminth") -Recurse }
Get-ChildItem (Join-Path $realGame "saves") -Directory | ForEach-Object {
  $to = Join-Path $fakeGame ("saves\" + $_.Name)
  New-Item -ItemType Directory -Force $to | Out-Null
  foreach ($f in "level.dat", "icon.png") { Copy-Item (Join-Path $_.FullName $f) (Join-Path $to $f) }
  foreach ($d in "stats", "players\stats") {
    $src = Join-Path $_.FullName $d
    if (Test-Path $src) { $dst = Join-Path $to $d; New-Item -ItemType Directory -Force (Split-Path $dst) | Out-Null; Copy-Item $src $dst -Recurse }
  }
}
