$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot
function Say($msg) { Write-Output $msg }

try {
    Say "=== publish started $(Get-Date -Format o) ==="
    git checkout main
    Say "--- status before ---"
    git status --short -- src site assets test README.md package.json package-lock.json

    git add -- src site assets test README.md package.json package-lock.json
    $staged = git diff --cached --name-only
    if ($staged) {
        Say "--- committing ---"
        $msg = @"
Reminth 1.4.0: mod update button, project pages, update button, safer mods

- "Update mods to fit" button; nested-mod detection; every replaced mod is kept
- Project page inside Discover (descriptions, gallery, versions, links)
- Settings: Check for updates; launcher re-checks every 6 hours
- Safe to delete + Delete all; mods locked while the game runs
- Home: Play on cards, hero = last played; window stays maximized after a game
- Privacy and Terms Version 6, in-app summaries updated

Co-Authored-By: Claude <noreply@anthropic.com>
"@
        $msgFile = Join-Path $env:TEMP "reminth-commit-msg.txt"
        [System.IO.File]::WriteAllText($msgFile, $msg)
        git commit -F $msgFile
        if ($LASTEXITCODE -ne 0) { throw "git commit failed" }
    } else {
        Say "Nothing new to commit."
    }

    Say "--- pulling latest from GitHub ---"
    git pull --rebase origin main
    if ($LASTEXITCODE -ne 0) { git rebase --abort; throw "git pull --rebase failed - nothing pushed." }

    Say "--- running tests ---"
    npm test *> npm-test-publish.txt
    $testExit = $LASTEXITCODE
    Get-Content npm-test-publish.txt | Select-Object -Last 12 | ForEach-Object { Say $_ }
    if ($testExit -ne 0) { throw "npm test failed (exit $testExit). Not pushing - see npm-test-publish.txt." }

    git push origin main
    if ($LASTEXITCODE -ne 0) { throw "git push failed" }
    Say "Pushed."
    git log --oneline -3
    Say "=== DONE $(Get-Date -Format o) ==="
} catch {
    Say "ERROR: $($_.Exception.Message)"
    exit 1
}
