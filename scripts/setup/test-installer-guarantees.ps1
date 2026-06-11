# test-installer-guarantees.ps1 - scratch-project test for the installer
# guarantees added in issue #133 (Windows mirror of
# test-installer-guarantees.sh - keep the two in lockstep).
#
# Verifies, against a throwaway project:
#   1. -DryRun makes zero filesystem changes (empty and populated targets)
#   2. The pre-flight report announces the version gap, migrations, locally
#      edited managed files, and custom files before anything is touched
#   3. Custom files planted in EVERY toolkit-managed directory (including a
#      nested command subdirectory) survive an upgrade byte-for-byte
#   4. A locally edited managed file is backed up, then refreshed to stock
#   5. Legacy migration targets are reported as migrations, not as custom
#      files, and are backed up before removal
#   6. An identical re-run creates no new backup directory
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\setup\test-installer-guarantees.ps1
#
# Exits 0 when every assertion passes, 1 otherwise. The scratch project
# lives under the user temp dir and is removed on exit. This script is NOT
# copied to downstream projects; it stays in the toolkit repo.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# .ProviderPath, not .Path: keeps UNC toolkit roots (\\wsl.localhost\...)
# usable with the .NET file APIs below.
$ToolkitRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).ProviderPath

$Work = Join-Path ([System.IO.Path]::GetTempPath()) ("toolkit-guarantee-test-" + [System.IO.Path]::GetRandomFileName())
$Scratch = Join-Path $Work "scratch"
$Snap = Join-Path $Work "snapshot"
$Log = Join-Path $Work "logs"
New-Item -ItemType Directory -Force -Path $Scratch | Out-Null
New-Item -ItemType Directory -Force -Path $Log | Out-Null

$script:Pass = 0
$script:Fail = 0
function Ok   { param([string]$Msg) $script:Pass++; Write-Host "  ok:   $Msg" }
function Failed { param([string]$Msg) $script:Fail++; Write-Host "  FAIL: $Msg" }

# Assert-Contains <fixed-string> <log-file> <label>
function Assert-Contains {
  param([string]$Needle, [string]$File, [string]$Label)
  $content = Get-Content -LiteralPath $File -Raw
  if ($content.Contains($Needle)) { Ok $Label } else { Failed "$Label (not found: $Needle)" }
}

function Test-FilesEqual {
  param([string]$A, [string]$B)
  if (-not (Test-Path -LiteralPath $A -PathType Leaf)) { return $false }
  if (-not (Test-Path -LiteralPath $B -PathType Leaf)) { return $false }
  $a = [System.IO.File]::ReadAllBytes($A)
  $b = [System.IO.File]::ReadAllBytes($B)
  if ($a.Length -ne $b.Length) { return $false }
  for ($i = 0; $i -lt $a.Length; $i++) { if ($a[$i] -ne $b[$i]) { return $false } }
  return $true
}

function Invoke-Setup {
  param([string[]]$SetupArgs, [string]$LogFile)
  $setupPath = Join-Path $ScriptDir "setup.ps1"
  & powershell -NoProfile -ExecutionPolicy Bypass -File $setupPath @SetupArgs *> $LogFile
}

try {
  Write-Host ""
  Write-Host "Toolkit: $ToolkitRoot"
  Write-Host "Scratch: $Scratch"
  Write-Host ""

  # --- [1] -DryRun on an empty target makes no changes ---------
  Write-Host "[1] -DryRun on an empty target"
  Invoke-Setup -SetupArgs @("-Target", $Scratch, "-DryRun") -LogFile (Join-Path $Log "dryrun-fresh.log")
  if (@(Get-ChildItem -Path $Scratch -Force).Count -eq 0) {
    Ok "empty target untouched"
  } else {
    Failed "dry run created files"
  }
  Assert-Contains "fresh install" (Join-Path $Log "dryrun-fresh.log") "reports fresh install"
  Assert-Contains "Dry run complete" (Join-Path $Log "dryrun-fresh.log") "prints dry-run completion line"

  # --- [2] fresh install ---------------------------------------
  Write-Host "[2] fresh install"
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "install.log")
  if (Test-Path -LiteralPath (Join-Path $Scratch ".claude\rules\toolkit.md") -PathType Leaf) {
    Ok "install completed"
  } else {
    Failed "install did not complete"
  }

  # --- [3] plant custom files + edit a managed file ------------
  Write-Host "[3] plant custom files in every managed directory"
  $CustomFiles = @(
    ".claude\commands\my-custom-command.md",
    ".claude\commands\team\nested-custom.md",
    ".claude\skills\my-custom-skill\SKILL.md",
    ".claude\skills\shared\my-custom-shared.md",
    ".claude\skills\shared\shells\my-custom-shell.html",
    ".claude\scripts\my-custom-script.js",
    ".claude\rules\my-custom-rule.md"
  )
  foreach ($rel in $CustomFiles) {
    $p = Join-Path $Scratch $rel
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $p) | Out-Null
    Set-Content -LiteralPath $p -Value "custom content for $rel"
  }

  # A legacy v3.4-era command file: must be reported as a migration, NOT
  # as a custom file, and must be backed up + removed by the upgrade.
  Set-Content -LiteralPath (Join-Path $Scratch ".claude\commands\review-code.md") -Value "old legacy command"

  # Locally edit a managed file (first toolkit command file, picked
  # dynamically so a rename upstream does not break the test).
  $EditedCmd = (Get-ChildItem -Path (Join-Path $ToolkitRoot ".claude\commands") -Filter *.md -File | Select-Object -First 1).Name
  Add-Content -LiteralPath (Join-Path $Scratch (Join-Path ".claude\commands" $EditedCmd)) -Value "`nLOCAL EDIT MARKER"

  # Simulate an older install so the version gap line has something to say.
  Set-Content -LiteralPath (Join-Path $Scratch "VERSION") -Value "4.0.0"
  Ok "planted $($CustomFiles.Count) custom files, 1 legacy file, 1 local edit"

  # --- [4] -DryRun on the populated project --------------------
  Write-Host "[4] -DryRun on the populated project"
  Copy-Item -Path $Scratch -Destination $Snap -Recurse
  $beforeState = Get-ChildItem -Path $Scratch -Recurse -Force | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" } | Sort-Object
  Invoke-Setup -SetupArgs @("-Target", $Scratch, "-DryRun") -LogFile (Join-Path $Log "dryrun.log")
  $afterState = Get-ChildItem -Path $Scratch -Recurse -Force | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" } | Sort-Object
  if (($beforeState -join "`n") -eq ($afterState -join "`n")) {
    Ok "dry run changed nothing"
  } else {
    Failed "dry run modified the target"
  }
  Assert-Contains "upgrade (v4.0.0 -> v" (Join-Path $Log "dryrun.log") "reports the version gap"
  Assert-Contains "Legacy command cleanup" (Join-Path $Log "dryrun.log") "announces the legacy migration"
  Assert-Contains ".claude\commands\$EditedCmd" (Join-Path $Log "dryrun.log") "lists the locally edited managed file"
  foreach ($rel in $CustomFiles) {
    Assert-Contains $rel (Join-Path $Log "dryrun.log") "lists custom file $rel"
  }
  $dryrunContent = Get-Content -LiteralPath (Join-Path $Log "dryrun.log") -Raw
  if ($dryrunContent.Contains("- .claude\commands\review-code.md")) {
    Failed "legacy file wrongly listed as a custom file"
  } else {
    Ok "legacy file not listed as custom"
  }

  # --- [5] real upgrade run ------------------------------------
  Write-Host "[5] real upgrade run"
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "upgrade.log")

  foreach ($rel in $CustomFiles) {
    if (Test-FilesEqual (Join-Path $Scratch $rel) (Join-Path $Snap $rel)) {
      Ok "custom file survived: $rel"
    } else {
      Failed "custom file modified or deleted: $rel"
    }
  }

  if (Test-FilesEqual (Join-Path $Scratch (Join-Path ".claude\commands" $EditedCmd)) (Join-Path $ToolkitRoot (Join-Path ".claude\commands" $EditedCmd))) {
    Ok "edited managed file refreshed to stock"
  } else {
    Failed "edited managed file does not match the incoming version"
  }

  $backupRoot = @(Get-ChildItem -Path $Scratch -Directory -Force -Filter ".toolkit-backup-*" | Sort-Object Name | Select-Object -Last 1)
  $backupEdited = if ($backupRoot.Count -gt 0) { Join-Path $backupRoot[0].FullName (Join-Path ".claude\commands" $EditedCmd) } else { $null }
  if ($backupEdited -and (Test-Path -LiteralPath $backupEdited -PathType Leaf) -and ((Get-Content -LiteralPath $backupEdited -Raw).Contains("LOCAL EDIT MARKER"))) {
    Ok "local edit preserved in backup"
  } else {
    Failed "local edit not found in backup dir"
  }

  $legacyGone = -not (Test-Path -LiteralPath (Join-Path $Scratch ".claude\commands\review-code.md") -PathType Leaf)
  $legacyBackedUp = $backupRoot.Count -gt 0 -and (Test-Path -LiteralPath (Join-Path $backupRoot[0].FullName ".claude\commands\review-code.md") -PathType Leaf)
  if ($legacyGone -and $legacyBackedUp) {
    Ok "legacy command removed and backed up"
  } else {
    Failed "legacy command not migrated correctly"
  }

  if ((Get-Content -LiteralPath (Join-Path $Scratch "VERSION") -Raw).Trim() -eq (Get-Content -LiteralPath (Join-Path $ToolkitRoot "VERSION") -Raw).Trim()) {
    Ok "VERSION updated"
  } else {
    Failed "VERSION not updated"
  }

  # --- [6] identical re-run is clean ---------------------------
  Write-Host "[6] identical re-run"
  $backupsBefore = @(Get-ChildItem -Path $Scratch -Directory -Force -Filter ".toolkit-backup-*").Count
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "rerun.log")
  $backupsAfter = @(Get-ChildItem -Path $Scratch -Directory -Force -Filter ".toolkit-backup-*").Count
  if ($backupsBefore -eq $backupsAfter) {
    Ok "no new backup dir on identical re-run"
  } else {
    Failed "identical re-run created a backup dir"
  }
  foreach ($rel in $CustomFiles) {
    if (Test-FilesEqual (Join-Path $Scratch $rel) (Join-Path $Snap $rel)) {
      Ok "custom file survived re-run: $rel"
    } else {
      Failed "custom file changed on re-run: $rel"
    }
  }
  Assert-Contains "older .toolkit-backup-" (Join-Path $Log "rerun.log") "re-run notes the stale backup dir"

} finally {
  if (Test-Path -LiteralPath $Work) {
    Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Results: $($script:Pass) passed, $($script:Fail) failed"
if ($script:Fail -gt 0) {
  exit 1
}
Write-Host "All installer guarantees hold."
exit 0
