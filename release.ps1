# Buzzer — release helper.
# Copies the development build (Buzzer/development/) over the production files
# (Buzzer/) and stages them for commit.
# Run from the repo root:  pwsh ./release.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$dev  = Join-Path $root "Buzzer\development"
$prod = Join-Path $root "Buzzer"

if (-not (Test-Path $dev)) { throw "Development folder not found: $dev" }

$copied = 0
Get-ChildItem -Path $dev -File | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination (Join-Path $prod $_.Name) -Force
  $copied++
}

Write-Host "Copied $copied file(s) from Buzzer/development/ -> Buzzer/"

git -C $root add "Buzzer"
Write-Host "Staged. Now review with 'git status', then:"
Write-Host "  git commit -m 'Release: publish development build'"
Write-Host "  git push"
