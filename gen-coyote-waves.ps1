# Buzzer — regenerate the bundled Coyote wave list from the Waves/ folder.
#
# The app does NOT read the Waves/ folder at runtime. The bundled waves are
# compiled into Buzzer/coyote-waves.js (and the development mirror), which is
# what index.html actually loads. After you rename or add .pulse files in
# Buzzer/Waves/, run this script so the app (and the AI companion's wave list)
# pick up the changes.
#
# Run from the repo root:   pwsh ./gen-coyote-waves.ps1
$ErrorActionPreference = "Stop"

$root     = Split-Path -Parent $MyInvocation.MyCommand.Path
$wavesDir = Join-Path $root "Buzzer\Waves"

if (-not (Test-Path $wavesDir)) { throw "Waves folder not found: $wavesDir" }

# Sort file names ordinally (case-insensitive) so the list order is stable.
$files = @(Get-ChildItem -Path $wavesDir -Filter "*.pulse" -File)
$list = New-Object 'System.Collections.Generic.List[System.IO.FileInfo]'
foreach ($f in $files) { $list.Add($f) }
$comparer = [System.Collections.Generic.Comparer[System.IO.FileInfo]]::Create(
    [System.Comparison[System.IO.FileInfo]]{ param($a, $b) [System.StringComparer]::OrdinalIgnoreCase.Compare($a.Name, $b.Name) }
)
$list.Sort($comparer)

$entries = @(
    foreach ($f in $list) {
        $raw = [System.IO.File]::ReadAllText($f.FullName)
        # The .pulse text is one line; strip any line endings so the bundle stays clean.
        $content = ($raw -replace "`r`n", "" -replace "`n", "" -replace "`r", "").Trim()
        [pscustomobject]@{ name = $f.BaseName; content = $content }
    }
)

$json = $entries | ConvertTo-Json -Compress -Depth 5
$js = "// Bundled Coyote .pulse waves (generated from the Waves/ folder).`nwindow.COYOTE_BUNDLED_PRESETS = " + $json + ";`n"

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path $root "Buzzer\coyote-waves.js"), $js, $utf8NoBom)
[System.IO.File]::WriteAllText((Join-Path $root "Buzzer\development\coyote-waves.js"), $js, $utf8NoBom)

Write-Host ("Wrote " + $entries.Count + " wave(s) to Buzzer/coyote-waves.js and Buzzer/development/coyote-waves.js")
