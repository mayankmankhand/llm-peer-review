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
#   4. A locally edited managed file blocks a non-interactive run (exit 1,
#      target untouched) until -Force is passed; the forced run backs the
#      file up, refreshes it to stock, and lists it (with its backup path)
#      in the post-setup summary (issue #138)
#   5. Legacy migration targets are reported as migrations, not as custom
#      files, and are backed up before removal
#   6. An identical re-run creates no new backup directory and never
#      triggers the overwrite gate
#   7. A manifest (.claude\.toolkit-manifest.json) is written on every real
#      run, never on -DryRun, and carries per-file sha256 entries
#   8. Every path an installed file READS at runtime resolves in the installed
#      tree, and no installed file points at docs/, which neither installer
#      copies (issue #153). Scoped deliberately: it checks the inline
#      `cat ...` directives, which are real filesystem reads, plus the docs/
#      class that caused the HITL-MAP.md dead links. It does NOT try to
#      resolve every path-shaped string in prose - most of those are
#      illustrative examples, literal placeholders, or runtime-generated
#      files, so a blanket check would be noise rather than signal.
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
  # Piping empty input redirects the child's stdin, so the overwrite gate
  # (issue #138) always detects a non-interactive host and takes the abort
  # path instead of blocking on Read-Host. The suite exercises the abort
  # path and the -Force path, never a live prompt.
  "" | & powershell -NoProfile -ExecutionPolicy Bypass -File $setupPath @SetupArgs *> $LogFile
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
  if (Test-Path -LiteralPath (Join-Path $Scratch ".claude\.toolkit-manifest.json") -PathType Leaf) {
    Ok "manifest written on fresh install"
  } else {
    Failed "manifest missing after fresh install"
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
  Assert-Contains "LOCALLY MODIFIED" (Join-Path $Log "dryrun.log") "shows the locally modified classification"
  foreach ($rel in $CustomFiles) {
    Assert-Contains $rel (Join-Path $Log "dryrun.log") "lists custom file $rel"
  }
  $dryrunContent = Get-Content -LiteralPath (Join-Path $Log "dryrun.log") -Raw
  if ($dryrunContent.Contains("- .claude\commands\review-code.md")) {
    Failed "legacy file wrongly listed as a custom file"
  } else {
    Ok "legacy file not listed as custom"
  }

  # --- [5] non-interactive upgrade aborts on modified files ----
  # The overwrite gate (issue #138): a locally modified managed file plus
  # no -Force plus redirected stdin must abort with exit 1 before any
  # filesystem write.
  Write-Host "[5] upgrade without -Force aborts (modified file, non-interactive)"
  $beforeAbort = Get-ChildItem -Path $Scratch -Recurse -Force | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" } | Sort-Object
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "abort.log")
  $abortExit = $LASTEXITCODE
  $afterAbort = Get-ChildItem -Path $Scratch -Recurse -Force | ForEach-Object { "$($_.FullName)|$($_.Length)|$($_.LastWriteTimeUtc.Ticks)" } | Sort-Object
  if ($abortExit -eq 1) {
    Ok "aborted with exit 1"
  } else {
    Failed "expected exit 1, got $abortExit"
  }
  Assert-Contains ".claude\commands\$EditedCmd" (Join-Path $Log "abort.log") "abort lists the modified file"
  Assert-Contains "-Force" (Join-Path $Log "abort.log") "abort points at -Force"
  if ((Get-Content -LiteralPath (Join-Path $Scratch (Join-Path ".claude\commands" $EditedCmd)) -Raw).Contains("LOCAL EDIT MARKER")) {
    Ok "modified file untouched by the aborted run"
  } else {
    Failed "aborted run replaced the modified file"
  }
  if (($beforeAbort -join "`n") -eq ($afterAbort -join "`n")) {
    Ok "aborted run changed nothing"
  } else {
    Failed "aborted run modified the target"
  }

  # --- [6] real upgrade run (-Force) ---------------------------
  Write-Host "[6] real upgrade run (-Force)"
  Invoke-Setup -SetupArgs @("-Target", $Scratch, "-Force") -LogFile (Join-Path $Log "upgrade.log")

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

  Assert-Contains "Locally modified file(s) replaced with stock versions:" (Join-Path $Log "upgrade.log") "summary announces replaced modified files"
  $upgradeLog = Get-Content -LiteralPath (Join-Path $Log "upgrade.log") -Raw
  $backupLine = @($upgradeLog -split "`n" | Where-Object { $_ -match "backup: " -and $_ -match [regex]::Escape((Join-Path ".claude\commands" $EditedCmd)) })
  if ($backupLine.Count -gt 0) {
    Ok "summary pairs the modified file with its backup path"
  } else {
    Failed "backup path for the modified file missing from summary"
  }

  # Manifest guarantees (issue #138): written on the real run, one
  # plausible sha256 entry per managed file (forward-slash keys).
  $manifestPath = Join-Path $Scratch ".claude\.toolkit-manifest.json"
  $manifestRaw = ""
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $manifestRaw = Get-Content -LiteralPath $manifestPath -Raw
  }
  if ($manifestRaw -match ('"' + [regex]::Escape(".claude/commands/$EditedCmd") + '": "[0-9a-f]{64}"')) {
    Ok "manifest has a plausible entry for the refreshed file"
  } else {
    Failed "manifest entry for .claude/commands/$EditedCmd missing or malformed"
  }

  # --- [7] identical re-run is clean ---------------------------
  Write-Host "[7] identical re-run"
  $backupsBefore = @(Get-ChildItem -Path $Scratch -Directory -Force -Filter ".toolkit-backup-*").Count
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "rerun.log")
  $rerunExit = $LASTEXITCODE
  $backupsAfter = @(Get-ChildItem -Path $Scratch -Directory -Force -Filter ".toolkit-backup-*").Count
  if ($rerunExit -eq 0) {
    Ok "clean re-run exited 0"
  } else {
    Failed "clean re-run exited $rerunExit"
  }
  if ($backupsBefore -eq $backupsAfter) {
    Ok "no new backup dir on identical re-run"
  } else {
    Failed "identical re-run created a backup dir"
  }
  $rerunLog = Get-Content -LiteralPath (Join-Path $Log "rerun.log") -Raw
  if ($rerunLog -match '(?i)locally modified') {
    Failed "clean re-run triggered the overwrite gate"
  } else {
    Ok "clean re-run did not trigger the overwrite gate"
  }
  foreach ($rel in $CustomFiles) {
    if (Test-FilesEqual (Join-Path $Scratch $rel) (Join-Path $Snap $rel)) {
      Ok "custom file survived re-run: $rel"
    } else {
      Failed "custom file changed on re-run: $rel"
    }
  }
  Assert-Contains "older .toolkit-backup-" (Join-Path $Log "rerun.log") "re-run notes the stale backup dir"

  # --- [8] referenced paths resolve in the INSTALLED tree ------------------
  # Mirror of scenario 8 in test-installer-guarantees.sh. Runs against
  # $Scratch (a real install by this point), never the toolkit source: every
  # gap issue #153 found resolved fine in the source and only broke once
  # installed.
  Write-Host "[8] referenced-path resolution (installed tree)"

  $ClaudeDir = Join-Path $Scratch ".claude"
  $InstalledFiles = @()
  if (Test-Path -LiteralPath $ClaudeDir) {
    $InstalledFiles = Get-ChildItem -LiteralPath $ClaudeDir -Recurse -File -ErrorAction SilentlyContinue
  }

  # 8a. Inline cat directives are executed at skill-load time, so a missing
  #     target is a real break rather than a dead link in prose.
  $InlineRefs = @{}
  foreach ($f in $InstalledFiles) {
    $text = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -eq $text) { continue }
    foreach ($m in [regex]::Matches($text, '!`cat ([^`]+)`')) {
      $InlineRefs[$m.Groups[1].Value.Trim()] = $true
    }
  }
  $InlineTotal = 0
  $InlineMissing = 0
  foreach ($ref in $InlineRefs.Keys) {
    # Skip angle-bracket placeholders (e.g. .claude/skills/shared/<file>),
    # which are prose showing the syntax rather than a path anything reads.
    if ($ref -match '[<>]') { continue }
    $InlineTotal++
    $native = $ref -replace '/', '\'
    if (-not (Test-Path -LiteralPath (Join-Path $Scratch $native) -PathType Leaf)) {
      Failed "inline-read target missing from install: $ref"
      $InlineMissing++
    }
  }
  if ($InlineTotal -eq 0) {
    Failed "found no inline-read directives to check - the extraction pattern is probably broken"
  } elseif ($InlineMissing -eq 0) {
    Ok "all $InlineTotal inline-read targets resolve in the installed tree"
  }

  # 8b. Only a docs/ path that EXISTS in the toolkit source is a real dead
  #     link: a file that should have reached the install and did not. A docs/
  #     path in neither tree (docs/runbook.md in audit-html's sample report) is
  #     an illustrative example, so cross-referencing the source separates the
  #     two without an allowlist to maintain.
  $DocsRefs = @{}
  foreach ($f in $InstalledFiles) {
    $text = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction SilentlyContinue
    if ($null -eq $text) { continue }
    foreach ($m in [regex]::Matches($text, '(?<![A-Za-z0-9_./-])docs/[A-Za-z0-9._/-]+\.md')) {
      $DocsRefs[$m.Value] = $true
    }
  }
  $DocsBroken = @()
  foreach ($ref in $DocsRefs.Keys) {
    $native = $ref -replace '/', '\'
    $inSource = Test-Path -LiteralPath (Join-Path $ToolkitRoot $native) -PathType Leaf
    $inInstall = Test-Path -LiteralPath (Join-Path $Scratch $native) -PathType Leaf
    if ($inSource -and (-not $inInstall)) { $DocsBroken += $ref }
  }
  if ($DocsBroken.Count -eq 0) {
    Ok "no installed file cites a docs/ file that exists in the toolkit but was not copied"
  } else {
    Failed ("installed file(s) cite docs/ files present in the toolkit but not installed: " + ($DocsBroken -join " "))
  }

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
