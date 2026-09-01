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
#   9. A pre-manifest install (no manifest file) upgrades without a gate:
#      a differing managed file is "[differs, provenance unknown]", replaced
#      with the stock copy, and its edited copy lands in the backup dir
#  10. A managed path with NO manifest entry while a manifest exists is a
#      user-created file the toolkit now ships under the same name: it is
#      "[LOCALLY MODIFIED]", gates the run (exit 1 without -Force), and is
#      replaced only with -Force
#  11. A run that died after some copies but before the manifest write is
#      recovered by the next run: every file restored, the manifest rebuilt
#      whole, and no .toolkit-manifest.json.tmp left behind
#  12. The line-merged files (.gitignore, .claude\settings.local.json) and
#      the regenerated manifest each land in the backup dir as their
#      pre-merge copies whenever a run rewrites them
#  13. A settings.local.json node cannot parse produces a warning naming the
#      error, leaves the file untouched, and never prints the error text as
#      a "+" permission line
#  14. (ps1 only) The three blocks setup.ps1 gained for parity with setup.sh
#      work on Windows: legacy INDEX.md removal with its .gitignore cleanup,
#      the .claude\plans\ to plans\ migration, and the permission merge.
#      setup.sh has carried these since v4.x, so the bash suite has no
#      counterpart scenario.
#  15. (ps1 only) A reorder-only edit of a managed file is gated. The line
#      summary uses Compare-Object, which is order-insensitive, and an early
#      return on its empty result used to skip the hash classification.
#      setup.sh's diff is order-sensitive, so no counterpart there either.
#  16. (ps1 only) With node absent from PATH the pre-flight says the
#      permission merge will be skipped (one -DryRun, PATH restored after).
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

# Get-BackupDirNames: the .toolkit-backup-* directories under the scratch
# project, so a before/after comparison isolates the directory a single
# run created. Name order is not enough: the PID suffix does not sort by
# time. Get-NewBackupDir returns the full path of the one not in $Before.
function Get-BackupDirNames {
  return @(Get-ChildItem -Path $Scratch -Directory -Force -Filter ".toolkit-backup-*" -ErrorAction SilentlyContinue | ForEach-Object { $_.Name })
}
function Get-NewBackupDir {
  param([string[]]$Before)
  $new = @(Get-BackupDirNames | Where-Object { $Before -notcontains $_ })
  if ($new.Count -eq 0) { return $null }
  return (Join-Path $Scratch ($new | Sort-Object | Select-Object -Last 1))
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
  # The settings merge writes on a fresh install too (it adds the absolute-path
  # browse.js entries), and a template this run just copied must not be backed up.
  if ((Get-BackupDirNames).Count -eq 0) {
    Ok "fresh install created no backup dir"
  } else {
    Failed "fresh install created a backup dir"
  }

  # --- [3] plant custom files + edit a managed file ------------
  Write-Host "[3] plant custom files in every managed directory"
  $CustomFiles = @(
    ".claude\agents\my-custom-agent.md",
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

  # Shared handles for the scenarios below. $manifestPath was set in [6].
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  $editedRel = Join-Path ".claude\commands" $EditedCmd
  $editedPath = Join-Path $Scratch $editedRel
  $editedStock = Join-Path $ToolkitRoot $editedRel
  $giPath = Join-Path $Scratch ".gitignore"
  $settingsPath = Join-Path $Scratch ".claude\settings.local.json"

  # --- [9] pre-manifest upgrade: no manifest, no gate ------------
  # A target installed before the manifest existed has nothing to compare
  # against, so a differing managed file is "[differs, provenance unknown]":
  # replaced with a backup, never gated. A gate here would block every
  # pre-5.5 upgrade on files setup itself wrote.
  Write-Host "[9] pre-manifest upgrade (manifest absent, edited managed file)"
  Remove-Item -LiteralPath $manifestPath -Force
  Add-Content -LiteralPath $editedPath -Value "`nPRE-MANIFEST EDIT MARKER"
  $backupsBefore = Get-BackupDirNames
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "premanifest.log")
  $preExit = $LASTEXITCODE
  if ($preExit -eq 0) {
    Ok "pre-manifest upgrade exited 0 without -Force"
  } else {
    Failed "pre-manifest upgrade exited $preExit (expected 0: no manifest means no gate)"
  }
  $preLog = Get-Content -LiteralPath (Join-Path $Log "premanifest.log") -Raw
  $preLine = @($preLog -split "`n" | Where-Object { $_.Contains($editedRel) -and $_.Contains("[differs, provenance unknown]") })
  if ($preLine.Count -gt 0) {
    Ok "edited file labelled [differs, provenance unknown]"
  } else {
    Failed "edited file not labelled [differs, provenance unknown]"
  }
  if (Test-FilesEqual $editedPath $editedStock) {
    Ok "edited file replaced with the stock copy"
  } else {
    Failed "edited file not replaced with the stock copy"
  }
  $preBackup = Get-NewBackupDir -Before $backupsBefore
  $preBackupFile = if ($preBackup) { Join-Path $preBackup $editedRel } else { $null }
  if ($preBackupFile -and (Test-Path -LiteralPath $preBackupFile -PathType Leaf) -and ((Get-Content -LiteralPath $preBackupFile -Raw).Contains("PRE-MANIFEST EDIT MARKER"))) {
    Ok "edited copy preserved in the backup dir"
  } else {
    Failed "edited copy not found in the backup dir"
  }
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    Ok "manifest rebuilt after the pre-manifest upgrade"
  } else {
    Failed "manifest not rebuilt after the pre-manifest upgrade"
  }

  # --- [10] manifest collision gate ------------------------------
  # The manifest lists everything the last run wrote, so a managed path with
  # no entry while a manifest exists is a file the user created at a name the
  # toolkit now ships. It must gate exactly like a local edit: exit 1 without
  # -Force, replaced (and backed up) with it. The second command file is
  # used so this cannot interact with $EditedCmd's history above. Its entry
  # sits mid-manifest (commands are enumerated first), so dropping the line
  # keeps the JSON valid for setup.ps1's ConvertFrom-Json.
  Write-Host "[10] manifest collision gate (entry missing, file differs)"
  $CollideCmd = (Get-ChildItem -Path (Join-Path $ToolkitRoot ".claude\commands") -Filter *.md -File | Select-Object -Skip 1 -First 1).Name
  $collideRel = Join-Path ".claude\commands" $CollideCmd
  $collidePath = Join-Path $Scratch $collideRel
  $collideKey = '"' + ".claude/commands/$CollideCmd" + '": "'
  $mfKept = @(Get-Content -LiteralPath $manifestPath | Where-Object { -not $_.Contains($collideKey) })
  [System.IO.File]::WriteAllText($manifestPath, (($mfKept -join "`n") + "`n"), $utf8NoBom)
  if ((Get-Content -LiteralPath $manifestPath -Raw).Contains($collideKey)) {
    Failed "test setup: could not remove the manifest entry for $CollideCmd"
  }
  Add-Content -LiteralPath $collidePath -Value "`nUSER-CREATED COLLISION MARKER"
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "collide.log")
  $collideExit = $LASTEXITCODE
  if ($collideExit -eq 1) {
    Ok "collision aborted with exit 1 without -Force"
  } else {
    Failed "collision run exited $collideExit (expected 1)"
  }
  $collideLog = Get-Content -LiteralPath (Join-Path $Log "collide.log") -Raw
  $collideLine = @($collideLog -split "`n" | Where-Object { $_.Contains($collideRel) -and $_.Contains("[LOCALLY MODIFIED]") })
  if ($collideLine.Count -gt 0) {
    Ok "colliding file labelled [LOCALLY MODIFIED]"
  } else {
    Failed "colliding file not labelled [LOCALLY MODIFIED]"
  }
  if ((Get-Content -LiteralPath $collidePath -Raw).Contains("USER-CREATED COLLISION MARKER")) {
    Ok "colliding file untouched by the aborted run"
  } else {
    Failed "aborted run replaced the colliding file"
  }
  Invoke-Setup -SetupArgs @("-Target", $Scratch, "-Force") -LogFile (Join-Path $Log "collide-force.log")
  $collideForceExit = $LASTEXITCODE
  if ($collideForceExit -eq 0) {
    Ok "-Force run exited 0"
  } else {
    Failed "-Force run exited $collideForceExit"
  }
  if (Test-FilesEqual $collidePath (Join-Path $ToolkitRoot $collideRel)) {
    Ok "-Force replaced the colliding file with the stock copy"
  } else {
    Failed "-Force did not replace the colliding file"
  }
  $collideForceLog = Get-Content -LiteralPath (Join-Path $Log "collide-force.log") -Raw
  $collideBackupLine = @($collideForceLog -split "`n" | Where-Object { $_ -match "backup: " -and $_.Contains($collideRel) })
  if ($collideBackupLine.Count -gt 0) {
    Ok "forced run pairs the colliding file with its backup path"
  } else {
    Failed "forced run summary missing the colliding file's backup path"
  }

  # --- [11] interrupted run recovery -----------------------------
  # Simulates a run that died after some copies but before the manifest
  # write: manifest gone, three managed files gone. The re-run must restore
  # every file, write a whole manifest (byte-identical to the one the last
  # clean run wrote, since nothing else changed), and leave no .tmp behind.
  # The manifest is built in a .tmp sibling and moved into place so it is
  # always whole or absent, never partial.
  Write-Host "[11] interrupted run recovery"
  $LostShell = (Get-ChildItem -Path (Join-Path $ToolkitRoot ".claude\skills\shared\shells") -File | Select-Object -First 1).Name
  $LostFiles = @(
    $editedRel,
    ".claude\scripts\render-html.js",
    (Join-Path ".claude\skills\shared\shells" $LostShell)
  )
  $manifestBeforeInterrupt = Join-Path $Work "manifest-before-interrupt.json"
  Copy-Item -LiteralPath $manifestPath -Destination $manifestBeforeInterrupt -Force
  Remove-Item -LiteralPath $manifestPath -Force
  foreach ($rel in $LostFiles) { Remove-Item -LiteralPath (Join-Path $Scratch $rel) -Force }
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "interrupted.log")
  $intExit = $LASTEXITCODE
  if ($intExit -eq 0) {
    Ok "recovery run exited 0"
  } else {
    Failed "recovery run exited $intExit"
  }
  foreach ($rel in $LostFiles) {
    if (Test-FilesEqual (Join-Path $Scratch $rel) (Join-Path $ToolkitRoot $rel)) {
      Ok "restored: $rel"
    } else {
      Failed "not restored: $rel"
    }
  }
  # Completeness is checked three ways, because the first alone cannot catch a
  # writer that truncates consistently (both manifests would then match): the
  # rebuilt file equals the last clean run's, every restored file has an entry
  # (two of the three sit far down the list), and the file is closed properly.
  if (Test-FilesEqual $manifestPath $manifestBeforeInterrupt) {
    Ok "manifest rebuilt whole (identical to the last clean run's)"
  } else {
    Failed "rebuilt manifest differs from the last clean run's (partial or missing entries)"
  }
  $intManifest = ""
  if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $intManifest = Get-Content -LiteralPath $manifestPath -Raw
  }
  foreach ($rel in $LostFiles) {
    $key = $rel.Replace("\", "/")
    if ($intManifest -match ('"' + [regex]::Escape($key) + '": "[0-9a-f]{64}"')) {
      Ok "manifest has an entry for restored $rel"
    } else {
      Failed "manifest missing an entry for restored $rel"
    }
  }
  $intLastLine = @($intManifest -split "`n" | Where-Object { $_.Trim() -ne "" } | Select-Object -Last 1)
  if ($intLastLine.Count -gt 0 -and $intLastLine[0].Trim() -eq "}") {
    Ok "manifest is well-formed (closing brace present)"
  } else {
    Failed "manifest is not well-formed (no closing brace - partial write?)"
  }
  if (-not (Test-Path -LiteralPath ($manifestPath + ".tmp"))) {
    Ok "no .toolkit-manifest.json.tmp left behind"
  } else {
    Failed ".toolkit-manifest.json.tmp left behind"
  }

  # --- [12] backup completeness for merged files -----------------
  # .gitignore and settings.local.json are line-merged rather than copied,
  # and the manifest is regenerated; each is rewritten in place, so each
  # needs its pre-merge copy in the backup dir for a rollback to be whole.
  # A missing toolkit line/entry makes both merges write, and an older
  # toolkitVersion stamp (a real upgrade always changes it) makes the
  # manifest differ - so all three must back up in one run.
  Write-Host "[12] backup completeness for merged files"
  $GiLine = "artifacts/html/"
  $PermEntry = "Bash(git worktree *)"
  $giKept = @(Get-Content -LiteralPath $giPath | Where-Object { $_ -cne $GiLine })
  # Written WITHOUT a trailing newline so the merge's newline guard is
  # exercised: without the guard the restored line is glued onto the last
  # line and the exact-line check below fails.
  [System.IO.File]::WriteAllText($giPath, ($giKept -join "`n"), $utf8NoBom)
  $stKept = @(Get-Content -LiteralPath $settingsPath | Where-Object { -not $_.Contains('"' + $PermEntry + '",') })
  [System.IO.File]::WriteAllText($settingsPath, (($stKept -join "`n") + "`n"), $utf8NoBom)
  $mfRaw = Get-Content -LiteralPath $manifestPath -Raw
  $mfRaw = $mfRaw -replace '"toolkitVersion": "[^"]*"', '"toolkitVersion": "0.0.0-test"'
  [System.IO.File]::WriteAllText($manifestPath, $mfRaw, $utf8NoBom)
  if (((Get-Content -LiteralPath $giPath) -ccontains $GiLine) -or ((Get-Content -LiteralPath $settingsPath -Raw).Contains($PermEntry)) -or (-not (Get-Content -LiteralPath $manifestPath -Raw).Contains("0.0.0-test"))) {
    Failed "test setup: could not remove the gitignore line / permission entry, or restamp the manifest"
  }
  $backupsBefore = Get-BackupDirNames
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "merge-backup.log")
  $mbExit = $LASTEXITCODE
  if ($mbExit -eq 0) {
    Ok "merge-backup run exited 0"
  } else {
    Failed "merge-backup run exited $mbExit"
  }
  $mbBackup = Get-NewBackupDir -Before $backupsBefore
  foreach ($rel in @(".gitignore", ".claude\settings.local.json", ".claude\.toolkit-manifest.json")) {
    if ($mbBackup -and (Test-Path -LiteralPath (Join-Path $mbBackup $rel) -PathType Leaf)) {
      Ok "pre-merge copy backed up: $rel"
    } else {
      Failed "pre-merge copy missing from backup: $rel"
    }
  }
  $mbGi = if ($mbBackup) { Join-Path $mbBackup ".gitignore" } else { $null }
  if ($mbGi -and (Test-Path -LiteralPath $mbGi -PathType Leaf) -and -not ((Get-Content -LiteralPath $mbGi) -ccontains $GiLine)) {
    Ok "backed-up .gitignore is the pre-merge copy"
  } else {
    Failed "backed-up .gitignore is not the pre-merge copy"
  }
  if ((Get-Content -LiteralPath $giPath) -ccontains $GiLine) {
    Ok "live .gitignore has the restored line"
  } else {
    Failed "live .gitignore missing the restored line: $GiLine"
  }
  $mbSt = if ($mbBackup) { Join-Path $mbBackup ".claude\settings.local.json" } else { $null }
  if ($mbSt -and (Test-Path -LiteralPath $mbSt -PathType Leaf) -and -not ((Get-Content -LiteralPath $mbSt -Raw).Contains($PermEntry))) {
    Ok "backed-up settings.local.json is the pre-merge copy"
  } else {
    Failed "backed-up settings.local.json is not the pre-merge copy"
  }
  if ((Get-Content -LiteralPath $settingsPath -Raw).Contains($PermEntry)) {
    Ok "live settings.local.json has the restored entry"
  } else {
    Failed "live settings.local.json missing the restored entry: $PermEntry"
  }
  $mbMf = if ($mbBackup) { Join-Path $mbBackup ".claude\.toolkit-manifest.json" } else { $null }
  if ($mbMf -and (Test-Path -LiteralPath $mbMf -PathType Leaf) -and ((Get-Content -LiteralPath $mbMf -Raw).Contains("0.0.0-test"))) {
    Ok "backed-up manifest is the pre-run copy"
  } else {
    Failed "backed-up manifest is not the pre-run copy"
  }
  if (-not (Get-Content -LiteralPath $manifestPath -Raw).Contains("0.0.0-test")) {
    Ok "live manifest restamped with the current version"
  } else {
    Failed "live manifest still carries the old version stamp"
  }

  # --- [13] unparseable settings.local.json ----------------------
  # A settings.local.json node cannot parse must produce a warning that
  # names the error, leave the file untouched, never print the error text
  # as a "+ ..." permission line, and still exit 0.
  Write-Host "[13] unparseable settings.local.json"
  $settingsGood = Join-Path $Work "settings-good.json"
  $settingsBad = Join-Path $Work "settings-bad.json"
  Copy-Item -LiteralPath $settingsPath -Destination $settingsGood -Force
  [System.IO.File]::WriteAllText($settingsBad, "{ `"permissions`": { `"allow`": [ `"Bash(git status *)`", ] }`n", $utf8NoBom)
  Copy-Item -LiteralPath $settingsBad -Destination $settingsPath -Force
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "bad-settings.log")
  $badExit = $LASTEXITCODE
  if ($badExit -eq 0) {
    Ok "run with unparseable settings still exited 0"
  } else {
    Failed "run with unparseable settings exited $badExit"
  }
  Assert-Contains "Warning: could not merge permissions into .claude\settings.local.json (" (Join-Path $Log "bad-settings.log") "warns that the merge was skipped"
  Assert-Contains "SyntaxError" (Join-Path $Log "bad-settings.log") "warning names the error"
  Assert-Contains "add new entries by hand from the permissions" (Join-Path $Log "bad-settings.log") "warning points at the permissions table"
  $badLog = Get-Content -LiteralPath (Join-Path $Log "bad-settings.log") -Raw
  $badPlus = @($badLog -split "`n" | Where-Object { $_ -match '^\s+\+ ' -and ($_ -match 'Error' -or $_ -match '^\s+\+\s+at ') })
  if ($badPlus.Count -gt 0) {
    Failed "error text printed as a + permission line"
  } else {
    Ok "no error text printed as a + permission line"
  }
  if (Test-FilesEqual $settingsPath $settingsBad) {
    Ok "unparseable settings.local.json left unchanged"
  } else {
    Failed "unparseable settings.local.json was modified"
  }
  if (-not (Test-Path -LiteralPath ($settingsPath + ".tmp"))) {
    Ok "no settings.local.json.tmp left behind"
  } else {
    Failed "settings.local.json.tmp left behind"
  }
  Copy-Item -LiteralPath $settingsGood -Destination $settingsPath -Force

  # --- [14] ps1 parity: INDEX.md removal, plans migration, permission merge
  # setup.sh has carried these three blocks since v4.x; setup.ps1 gained
  # them in the holistic pass, so this scenario proves the Windows side.
  # No counterpart in test-installer-guarantees.sh.
  Write-Host "[14] parity: INDEX.md removal, plans migration, permission merge"
  $indexPath = Join-Path $Scratch "INDEX.md"
  [System.IO.File]::WriteAllText($indexPath, "legacy flat index`n", $utf8NoBom)
  $giText = Get-Content -LiteralPath $giPath -Raw
  if (-not $giText.EndsWith("`n")) { $giText += "`n" }
  $giText += "# Project index (auto-generated by toolkit)`nINDEX.md`n"
  [System.IO.File]::WriteAllText($giPath, $giText, $utf8NoBom)
  $oldPlansDir = Join-Path $Scratch ".claude\plans"
  New-Item -ItemType Directory -Force -Path $oldPlansDir | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $oldPlansDir "PLAN-parity.md"), "# parity plan`n", $utf8NoBom)
  [System.IO.File]::WriteAllText((Join-Path $oldPlansDir ".gitkeep"), "", $utf8NoBom)
  $ParityPerm = "Bash(git stash *)"
  $stKept = @(Get-Content -LiteralPath $settingsPath | Where-Object { -not $_.Contains('"' + $ParityPerm + '",') })
  [System.IO.File]::WriteAllText($settingsPath, (($stKept -join "`n") + "`n"), $utf8NoBom)
  # The pre-flight must announce both migrations before anything runs.
  Invoke-Setup -SetupArgs @("-Target", $Scratch, "-DryRun") -LogFile (Join-Path $Log "parity-dryrun.log")
  Assert-Contains "Legacy INDEX.md removal" (Join-Path $Log "parity-dryrun.log") "pre-flight announces the INDEX.md removal"
  Assert-Contains "Plan migration (v4.0): 1 plan(s) move from .claude\plans\ to plans\" (Join-Path $Log "parity-dryrun.log") "pre-flight announces the plan migration"
  if ((Test-Path -LiteralPath $indexPath -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $oldPlansDir "PLAN-parity.md") -PathType Leaf)) {
    Ok "dry run left INDEX.md and the old plan in place"
  } else {
    Failed "dry run removed INDEX.md or moved the plan"
  }
  $backupsBefore = Get-BackupDirNames
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "parity.log")
  $parityExit = $LASTEXITCODE
  if ($parityExit -eq 0) {
    Ok "parity run exited 0"
  } else {
    Failed "parity run exited $parityExit"
  }
  $parityBackup = Get-NewBackupDir -Before $backupsBefore
  if ((-not (Test-Path -LiteralPath $indexPath)) -and $parityBackup -and (Test-Path -LiteralPath (Join-Path $parityBackup "INDEX.md") -PathType Leaf)) {
    Ok "legacy INDEX.md removed and backed up"
  } else {
    Failed "legacy INDEX.md not removed or not backed up"
  }
  Assert-Contains "Removed legacy INDEX.md (replaced by CODEBASE_MAP.md - generated on first /explore)" (Join-Path $Log "parity.log") "announces the INDEX.md removal"
  $giLines = @(Get-Content -LiteralPath $giPath)
  if ((-not ($giLines -ccontains "INDEX.md")) -and (-not ($giLines -ccontains "# Project index (auto-generated by toolkit)"))) {
    Ok ".gitignore no longer carries the INDEX.md entries"
  } else {
    Failed ".gitignore still carries the INDEX.md entries"
  }
  Assert-Contains "Cleaned stale INDEX.md entries from .gitignore" (Join-Path $Log "parity.log") "announces the .gitignore cleanup"
  $parityGi = if ($parityBackup) { Join-Path $parityBackup ".gitignore" } else { $null }
  if ($parityGi -and (Test-Path -LiteralPath $parityGi -PathType Leaf) -and ((Get-Content -LiteralPath $parityGi) -ccontains "INDEX.md")) {
    Ok "backed-up .gitignore is the pre-cleanup copy"
  } else {
    Failed "backed-up .gitignore is not the pre-cleanup copy"
  }
  if ($giLines -ccontains $GiLine) {
    Ok ".gitignore kept its other lines through the cleanup"
  } else {
    Failed ".gitignore lost a toolkit line during the cleanup"
  }
  $newPlan = Join-Path $Scratch "plans\PLAN-parity.md"
  if ((Test-Path -LiteralPath $newPlan -PathType Leaf) -and ((Get-Content -LiteralPath $newPlan -Raw).Contains("# parity plan"))) {
    Ok "plan moved to plans\ with its content"
  } else {
    Failed "plan not moved to plans\"
  }
  if (-not (Test-Path -LiteralPath $oldPlansDir)) {
    Ok "empty .claude\plans\ removed (with its .gitkeep)"
  } else {
    Failed ".claude\plans\ left behind"
  }
  Assert-Contains "Migrated 1 plan file(s) from .claude\plans\ to plans\" (Join-Path $Log "parity.log") "announces the plan migration"
  Assert-Contains "Plans moved from .claude\plans\ to plans\" (Join-Path $Log "parity.log") "upgrade notes box mentions the moved plans"
  if ((Get-Content -LiteralPath $settingsPath -Raw).Contains($ParityPerm)) {
    Ok "permission merge restored the missing template entry"
  } else {
    Failed "permission merge did not restore $ParityPerm"
  }
  Assert-Contains "Updating permissions in .claude\settings.local.json ..." (Join-Path $Log "parity.log") "announces the permission merge"
  Assert-Contains "+ $ParityPerm" (Join-Path $Log "parity.log") "lists the added permission"

  # --- [15] ps1 only: a reorder-only edit is gated ------------------
  # Get-PreflightDiffSummary uses Compare-Object, which is order-insensitive:
  # a file whose lines were merely reordered has no line summary at all.
  # Add-PreflightDiff used to return early on that empty summary, so the
  # edit was never hashed, never classified, and Invoke-SafeCopy (which
  # byte-compares) silently overwrote it. Reuses the second command file,
  # which [10] left at stock with a manifest entry.
  Write-Host "[15] reorder-only edit is gated (ps1 only)"
  $reorderLines = @(Get-Content -LiteralPath $collidePath)
  [array]::Reverse($reorderLines)
  [System.IO.File]::WriteAllText($collidePath, (($reorderLines -join "`n") + "`n"), $utf8NoBom)
  Invoke-Setup -SetupArgs @("-Target", $Scratch) -LogFile (Join-Path $Log "reorder.log")
  $reorderExit = $LASTEXITCODE
  if ($reorderExit -eq 1) {
    Ok "reorder-only edit aborted with exit 1 without -Force"
  } else {
    Failed "reorder-only edit run exited $reorderExit (expected 1)"
  }
  $reorderLog = Get-Content -LiteralPath (Join-Path $Log "reorder.log") -Raw
  $reorderLine = @($reorderLog -split "`n" | Where-Object { $_.Contains($collideRel) -and $_.Contains("[LOCALLY MODIFIED]") })
  if ($reorderLine.Count -gt 0) {
    Ok "reordered file labelled [LOCALLY MODIFIED]"
  } else {
    Failed "reordered file not labelled [LOCALLY MODIFIED]"
  }
  Invoke-Setup -SetupArgs @("-Target", $Scratch, "-Force") -LogFile (Join-Path $Log "reorder-force.log")
  if (Test-FilesEqual $collidePath (Join-Path $ToolkitRoot $collideRel)) {
    Ok "-Force restored the reordered file to stock"
  } else {
    Failed "-Force did not restore the reordered file"
  }

  # --- [16] ps1 only: node-absent pre-flight note ------------------
  # The permission merge needs node. When it is missing the pre-flight must
  # say so up front rather than letting the merge silently not happen. PATH
  # is trimmed of every directory holding node.exe or node.cmd for one
  # -DryRun (nothing is written), then restored.
  Write-Host "[16] node-absent pre-flight note (ps1 only)"
  $savedPath = $env:PATH
  try {
    $env:PATH = (@($env:PATH -split ';' | Where-Object {
      $dir = $_
      if (-not $dir) { return $false }
      try {
        return -not ((Test-Path -LiteralPath (Join-Path $dir "node.exe")) -or (Test-Path -LiteralPath (Join-Path $dir "node.cmd")))
      } catch {
        return $true
      }
    })) -join ';'
    Invoke-Setup -SetupArgs @("-Target", $Scratch, "-DryRun") -LogFile (Join-Path $Log "no-node.log")
  } finally {
    $env:PATH = $savedPath
  }
  Assert-Contains "Note: node was not found, so the .claude\settings.local.json permission" (Join-Path $Log "no-node.log") "pre-flight notes that node is missing"
  Assert-Contains "Dry run complete" (Join-Path $Log "no-node.log") "dry run without node still completes"

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
