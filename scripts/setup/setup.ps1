# setup.ps1 - Copy the LLM Peer Review toolkit into any project (Windows PowerShell).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup\setup.ps1 -Target "C:\path\to\your-project" [-DryRun] [-Force]
#
# If -Target is omitted, uses the current working directory (but will error if run from inside the toolkit repo).
#
# -DryRun prints the pre-flight report (version gap, migrations that would
# run, managed files that would be overwritten, custom files that are left
# alone, backup location) and exits without creating, modifying, or
# deleting anything.
#
# -Force skips the overwrite confirmation for locally modified managed
# files (issue #138). Without it, setup prompts before replacing files
# you have edited, and aborts when it cannot prompt (non-interactive
# host). Every replaced file is backed up first either way.
#
# Examples:
#   # From toolkit repo, specify target:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup\setup.ps1 -Target "C:\Projects\my-app"
#
#   # See what an upgrade would do without changing anything:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup\setup.ps1 -Target "C:\Projects\my-app" -DryRun
#
#   # From your project directory:
#   cd C:\Projects\my-app
#   powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup\setup.ps1

param(
  [string]$Target = ".",
  [switch]$DryRun,
  [switch]$Force
)

# Check PowerShell version (requires 5.1+)
if ($PSVersionTable.PSVersion.Major -lt 5) {
  Write-Host ""
  Write-Host "  Error: PowerShell 5.1 or later is required"
  Write-Host "  Current version: $($PSVersionTable.PSVersion)"
  Write-Host ""
  exit 1
}

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
# .ProviderPath, not .Path: for UNC locations (e.g. a toolkit checked out
# under \\wsl.localhost\...) .Path returns a provider-qualified string
# ("Microsoft.PowerShell.Core\FileSystem::\\...") that the .NET file APIs
# used by Invoke-SafeCopy cannot parse. .ProviderPath is always the plain
# filesystem form and is identical to .Path for local drive paths.
$ToolkitRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).ProviderPath

# If no target specified, prompt for it
if ($Target -eq ".") {
  $currentDir = (Get-Location).Path
  $resolvedCurrent = (Resolve-Path -LiteralPath $currentDir).ProviderPath
  $resolvedToolkit = (Resolve-Path -LiteralPath $ToolkitRoot).ProviderPath
  
  # Check if we're trying to copy into the toolkit repo itself
  if ($resolvedCurrent -eq $resolvedToolkit -or $resolvedCurrent.StartsWith($resolvedToolkit + "\")) {
    Write-Host ""
    Write-Host "  Error: No target directory specified"
    Write-Host ""
    Write-Host "  You're running this from inside the toolkit repository."
    Write-Host "  Please specify a target project directory:"
    Write-Host ""
    Write-Host "    powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Target `"C:\path\to\your-project`""
    Write-Host ""
    Write-Host "  Or run it from your target project directory:"
    Write-Host ""
    Write-Host "    cd C:\path\to\your-project"
    Write-Host "    powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`""
    Write-Host ""
    exit 1
  }
  
  # If we're in a different directory, use current directory as target
  $Target = $resolvedCurrent
} else {
  if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
    Write-Host ""
    Write-Host "  Error: target directory does not exist: $Target"
    Write-Host "  Create it first:  New-Item -ItemType Directory -Path '$Target'"
    Write-Host ""
    exit 1
  }
  $Target = (Resolve-Path -LiteralPath $Target).ProviderPath
}

# ─── Read version ─────────────────────────────────────────────
$VersionFile = Join-Path $ToolkitRoot "VERSION"
$Version = "unknown"
if (Test-Path -LiteralPath $VersionFile) {
  $Version = (Get-Content -LiteralPath $VersionFile -Raw).Trim()
}

Write-Host ""
Write-Host "  ================================"
Write-Host "   LLM Peer Review v$Version"
Write-Host "  ================================"
Write-Host ""
Write-Host "    From:  $ToolkitRoot"
Write-Host "    Into:  $Target"
Write-Host ""

$PreflightOk = $true

$CommandsDir = Join-Path $ToolkitRoot ".claude\commands"
if (-not (Test-Path -LiteralPath $CommandsDir -PathType Container)) {
  Write-Host "  Error: source directory not found: $CommandsDir"
  $PreflightOk = $false
} else {
  $CommandFiles = Get-ChildItem -Path $CommandsDir -Filter *.md -File
  if ($CommandFiles.Count -eq 0) {
    Write-Host "  Error: no .md command files found in $CommandsDir"
    $PreflightOk = $false
  }
}

# Check runtime scripts and the quarantined package.json (must exist).
# Runtime scripts live in .claude\scripts\ alongside their own package.json
# so end users of downstream projects don't inherit toolkit-only deps.
foreach ($f in @("ask-gpt.js", "ask-gemini.js", "browse.js", "package.json")) {
  $p = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $f)
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Error: source file not found: $p"
    $PreflightOk = $false
  }
}

# Check setup scripts (must exist in setup folder)
foreach ($f in @("setup.sh", "setup.ps1", "install-alias.sh", "install-alias.ps1")) {
  $p = Join-Path $ToolkitRoot (Join-Path "scripts\setup" $f)
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Error: source file not found: $p"
    $PreflightOk = $false
  }
}

# Check dep-free runtime scripts (index generator + artifact opener + HTML renderer + session-init) - must exist.
foreach ($f in @("generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js")) {
  $p = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $f)
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Error: source file not found: $p"
    $PreflightOk = $false
  }
}

foreach ($f in @("VERSION", "CLAUDE.md", "LESSONS.md", "LESSONS-detail.md", ".env.local.example", ".claude\settings.local.json", ".claude\rules\toolkit.md", ".claude\rules\html-outputs.md", "artifacts\README.md", ".gitignore", ".gitattributes")) {
  $p = Join-Path $ToolkitRoot $f
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Error: source file not found: $p"
    $PreflightOk = $false
  }
}

if (-not $PreflightOk) {
  Write-Host ""
  Write-Host "  The toolkit source looks incomplete. Make sure you're running"
  Write-Host "  this from a valid llm-peer-review repo."
  Write-Host ""
  exit 1
}

# ─── Check for conflicting global commands ───────────────────
# If ~/.claude/commands/ has files with the same names as toolkit commands,
# they can override project-level commands and cause stale behavior.
$GlobalCmdDir = Join-Path $HOME ".claude\commands"
if (Test-Path -LiteralPath $GlobalCmdDir -PathType Container) {
  $Conflicts = @()
  foreach ($src in Get-ChildItem -Path $CommandsDir -Filter *.md -File) {
    $globalFile = Join-Path $GlobalCmdDir $src.Name
    if (Test-Path -LiteralPath $globalFile -PathType Leaf) {
      $Conflicts += $src.Name
    }
  }

  if ($Conflicts.Count -gt 0) {
    Write-Host "  +----------------------------------------------------+"
    Write-Host "  |  WARNING: Global commands may override this setup   |"
    Write-Host "  +----------------------------------------------------+"
    Write-Host ""
    Write-Host "    Found $($Conflicts.Count) file(s) in $GlobalCmdDir\"
    Write-Host "    that share names with toolkit commands:"
    Write-Host ""
    foreach ($f in $Conflicts) {
      Write-Host "      - $f"
    }
    Write-Host ""
    Write-Host "    Global commands (~/.claude/commands/) can override"
    Write-Host "    project commands (.claude/commands/), so you may get"
    Write-Host "    outdated behavior even after updating the toolkit."
    Write-Host ""
    Write-Host "    To fix: delete the global copies listed above."
    Write-Host "    They are not needed - the toolkit puts commands in"
    Write-Host "    each project's .claude/commands/ folder instead."
    Write-Host ""
  }
}

# --- Detect install vs upgrade ---------------------------------
# Captured here, before any directory is created, so we can tell later
# whether this target already had a toolkit install. The presence of a
# managed rules file is the most reliable signal: setup always writes
# it, so a pre-existing copy proves an earlier setup ran. Mirrors the
# IS_UPGRADE check in setup.sh.
$IsUpgrade = $false
if (Test-Path -LiteralPath (Join-Path $Target ".claude\rules\toolkit.md") -PathType Leaf) {
  $IsUpgrade = $true
}

# --- Migration inventory (issue #133) --------------------------
# The legacy-path lists consumed by the migration blocks further down,
# defined once up here so the pre-flight report can announce which
# migrations will run BEFORE any of them executes. Mirrors the migration
# inventory in setup.sh - keep both in lockstep.

# v3.4 -> v3.5: commands that became skills (deleted before copy to
# avoid name conflicts; backed up first).
$LegacyCommands = @("review-code.md", "review-ux.md", "review-plan.md", "review-commands.md", "review-browser.md", "review-full.md", "learning-opportunity.md")

# Issue #80: upstream renames, old -> new. Paths relative to $Target.
$RenamedFiles = @(
  @{ Old = ".claude\commands\dev-lead-gpt.md";    New = ".claude\commands\ask-gpt.md" },
  @{ Old = ".claude\commands\dev-lead-gemini.md"; New = ".claude\commands\ask-gemini.md" },
  @{ Old = "scripts\dev-lead-gpt.js";             New = ".claude\scripts\ask-gpt.js" },
  @{ Old = "scripts\dev-lead-gemini.js";          New = ".claude\scripts\ask-gemini.js" }
)

# Issue #91 (v4.2 -> v4.3): runtime scripts that moved from scripts\ to
# .claude\scripts\, plus the toolkit-owned package.json deps and script
# entries cleaned from the target. Keep in lockstep with setup.sh
# (issue #133 parity note: @google/genai was missing here before).
$Issue91OldScripts = @("scripts\ask-gpt.js", "scripts\ask-gemini.js", "scripts\browse.js")
$Issue91ToolkitDeps = @("openai", "@google/generative-ai", "@google/genai", "playwright-core", "@axe-core/playwright")
$Issue91ToolkitScripts = @("ask-gpt", "ask-gemini")

# --- Pre-flight report (issue #133) ----------------------------
# Everything in this section is READ-ONLY. It prints what this run will
# do - the version gap, which migrations fire, which managed files will
# be overwritten (with a diff summary), which custom files are left
# alone, and where backups go - BEFORE any file is created, modified,
# or deleted. With -DryRun, the script exits right after this report.
# Mirrors the pre-flight section in setup.sh.

# The backup directory name is fixed here so the report can announce the
# location up front. Creation stays lazy: the directory only appears if
# something is actually backed up. The $PID suffix keeps two same-second
# runs from sharing a backup dir.
$pfStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$script:BackupDir = Join-Path $Target ".toolkit-backup-$pfStamp-$PID"

# Old version for the gap line. $IsUpgrade (not the VERSION file) decides
# install vs upgrade: early toolkit versions did not ship VERSION, and a
# fresh target may carry its own unrelated VERSION file.
$OldVersion = ""
$pfTargetVersionFile = Join-Path $Target "VERSION"
if ($IsUpgrade -and (Test-Path -LiteralPath $pfTargetVersionFile -PathType Leaf)) {
  $OldVersion = (Get-Content -LiteralPath $pfTargetVersionFile -Raw).Trim()
}

# Get-PreflightDiffSummary: line-level diff summary between the incoming
# source file and the target's current copy. Returns $null when the target
# copy is missing or identical. -IgnoreVersionStamp drops the managed-
# version stamp line both rules files carry, so a pure version-bump
# difference is not misreported as a local edit. Line-based comparison
# also keeps CRLF/LF-only differences from showing up as edits.
function Get-PreflightDiffSummary {
  param(
    [string]$Source,
    [string]$Destination,
    [switch]$IgnoreVersionStamp
  )
  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) { return $null }
  $srcLines = @(Get-Content -LiteralPath $Source)
  $dstLines = @(Get-Content -LiteralPath $Destination)
  if ($IgnoreVersionStamp) {
    $stampPattern = '<!-- Toolkit version: .* \| Managed by LLM Peer Review\.|<!-- This file is managed by the LLM Peer Review toolkit\.'
    $srcLines = @($srcLines | Where-Object { $_ -notmatch $stampPattern })
    $dstLines = @($dstLines | Where-Object { $_ -notmatch $stampPattern })
  }
  # Handle empty sides explicitly - Compare-Object rejects empty arrays.
  if ($srcLines.Count -eq 0 -and $dstLines.Count -eq 0) { return $null }
  if ($srcLines.Count -eq 0) { return "+0/-$($dstLines.Count) line(s) vs incoming" }
  if ($dstLines.Count -eq 0) { return "+$($srcLines.Count)/-0 line(s) vs incoming" }
  $cmp = @(Compare-Object -ReferenceObject $dstLines -DifferenceObject $srcLines)
  if ($cmp.Count -eq 0) { return $null }
  $added = @($cmp | Where-Object { $_.SideIndicator -eq "=>" }).Count
  $removed = @($cmp | Where-Object { $_.SideIndicator -eq "<=" }).Count
  return "+$added/-$removed line(s) vs incoming"
}

# --- Overwrite guardrails: hashes + manifest (issue #138) ------
# The manifest written at the end of every real run records the sha256 of
# each managed file exactly as setup left it on disk. On the next run,
# comparing a file's current hash against that recorded hash separates
# "locally modified" (the user edited it - confirm before overwriting)
# from "outdated" (setup wrote it and the toolkit has since moved on -
# normal overwrite with backup). Hashes are EOL-normalized (CR bytes
# stripped before hashing) so a CRLF flip on Windows never flags a file
# as modified; forward-slash keys keep the manifest portable between
# setup.sh and setup.ps1. Mirrors the guardrail blocks in setup.sh.
$script:ManifestPath = Join-Path $Target ".claude\.toolkit-manifest.json"

# Get-ToolkitFileHash: EOL-normalized sha256 of a file. Latin-1 (code
# page 28591) round-trips every byte 1:1, so stripping CR from the
# decoded text and re-encoding hashes exactly the raw bytes minus CR -
# the same digest setup.sh computes with `tr -d '\r' | sha256sum`.
# -IgnoreVersionStamp additionally drops the managed-version stamp line
# the two rules files carry (the PF_STAMP_SED equivalent), so a pure
# version-bump difference never reads as a local edit. PS 5.1 compatible.
function Get-ToolkitFileHash {
  param([string]$Path, [switch]$IgnoreVersionStamp)
  $enc = [System.Text.Encoding]::GetEncoding(28591)
  $text = $enc.GetString([System.IO.File]::ReadAllBytes($Path))
  $text = $text.Replace("`r", "")
  if ($IgnoreVersionStamp) {
    $stampPattern = '<!-- Toolkit version: .* \| Managed by LLM Peer Review\.|<!-- This file is managed by the LLM Peer Review toolkit\.'
    $lines = @($text -split "`n" | Where-Object { $_ -notmatch $stampPattern })
    $text = $lines -join "`n"
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hashBytes = $sha.ComputeHash($enc.GetBytes($text))
  $sha.Dispose()
  return ([System.BitConverter]::ToString($hashBytes)).Replace("-", "").ToLowerInvariant()
}

# Load the existing manifest (if any) into a hashtable keyed by the
# forward-slash relative path. An unreadable manifest is treated as
# absent - the pre-manifest warn+backup behavior, never a hard failure.
$script:ManifestHashes = @{}
if (Test-Path -LiteralPath $script:ManifestPath -PathType Leaf) {
  try {
    $mf = (Get-Content -LiteralPath $script:ManifestPath -Raw) | ConvertFrom-Json
    if ($mf.PSObject.Properties.Name -contains "files" -and $mf.files) {
      foreach ($prop in $mf.files.PSObject.Properties) {
        $script:ManifestHashes[$prop.Name] = $prop.Value
      }
    }
  } catch {
    # Corrupt or hand-edited manifest - fall back to pre-manifest behavior
  }
}

# Add-PreflightDiff: record a managed file in the will-be-overwritten
# list when its target copy differs from the incoming version, with a
# manifest-based classification (issue #138):
#   [LOCALLY MODIFIED]            the user edited the file since setup
#                                 last wrote it - the overwrite gate below
#                                 will prompt (or require -Force)
#   [outdated]                    the file matches what setup last wrote,
#                                 the toolkit has just moved on - normal
#                                 overwrite with backup, no gate
#   [differs, provenance unknown] no manifest entry to compare against
#                                 (pre-manifest install or interrupted
#                                 run) - warn+backup behavior, no gate
# Every enumerated file also joins $script:ManagedRels, whether or not it
# exists in the target yet: the manifest write at the end of the run
# reuses that list, so the two enumerations cannot drift apart.
$script:PfDiffs = @()
$script:PfModified = @()
$script:ManagedRels = @()
function Add-PreflightDiff {
  param([string]$Source, [string]$Rel, [switch]$IgnoreVersionStamp)
  $dst = Join-Path $Target $Rel
  $script:ManagedRels += $Rel
  if (-not (Test-Path -LiteralPath $dst -PathType Leaf)) { return }
  $summary = Get-PreflightDiffSummary -Source $Source -Destination $dst -IgnoreVersionStamp:$IgnoreVersionStamp
  if (-not $summary) { return }
  # Classification for the overwrite gate. The clean check (current vs
  # incoming, stamp-normalized for the two rules files) uses the same
  # normalization as the diff summary. The manifest hash was recorded
  # from the FINAL on-disk file of the previous run (after version
  # stamping), so it is compared against the plain EOL-normalized hash.
  $label = ""
  $curNorm = Get-ToolkitFileHash -Path $dst -IgnoreVersionStamp:$IgnoreVersionStamp
  $incNorm = Get-ToolkitFileHash -Path $Source -IgnoreVersionStamp:$IgnoreVersionStamp
  if ($curNorm -ne $incNorm) {
    $relKey = $Rel.Replace("\", "/")
    if ($script:ManifestHashes.ContainsKey($relKey)) {
      $curPlain = Get-ToolkitFileHash -Path $dst
      if ($curPlain -eq $script:ManifestHashes[$relKey]) {
        $label = " [outdated]"
      } else {
        $label = " [LOCALLY MODIFIED]"
        $script:PfModified += $Rel
      }
    } else {
      $label = " [differs, provenance unknown]"
    }
  }
  $script:PfDiffs += "$Rel  ($summary)$label"
}

# Which staged migrations will fire. Read-only mirrors of the conditions
# the migration blocks below check.
$PfMigrations = @()
$pfCount = 0
foreach ($pfName in $LegacyCommands) {
  if (Test-Path -LiteralPath (Join-Path $Target (Join-Path ".claude\commands" $pfName)) -PathType Leaf) { $pfCount++ }
}
if ($pfCount -gt 0) {
  $PfMigrations += "Legacy command cleanup (v3.5): $pfCount command file(s) became skills - old copies backed up, then removed"
}
$pfCount = 0
foreach ($r in $RenamedFiles) {
  if (Test-Path -LiteralPath (Join-Path $Target $r.Old) -PathType Leaf) { $pfCount++ }
}
if ($pfCount -gt 0) {
  $PfMigrations += "Renamed-file cleanup (issue #80): $pfCount old-named file(s) backed up, then removed"
}
$pfCount = 0
foreach ($pfRel in $Issue91OldScripts) {
  if (Test-Path -LiteralPath (Join-Path $Target $pfRel) -PathType Leaf) { $pfCount++ }
}
if ($pfCount -gt 0) {
  $PfMigrations += "Script relocation (issue #91): $pfCount old script(s) under scripts\ backed up, then removed"
}

# Issue #91 package.json detection (read-only; the migration block below
# performs the actual rewrite using the same lists).
$Issue91PkgWillChange = $false
$pfPkgPath = Join-Path $Target "package.json"
if (Test-Path -LiteralPath $pfPkgPath -PathType Leaf) {
  try {
    $pfPkg = (Get-Content -LiteralPath $pfPkgPath -Raw) | ConvertFrom-Json
    if ($pfPkg.PSObject.Properties.Name -contains "dependencies" -and $pfPkg.dependencies) {
      foreach ($dep in $Issue91ToolkitDeps) {
        if ($pfPkg.dependencies.PSObject.Properties.Name -contains $dep) { $Issue91PkgWillChange = $true; break }
      }
    }
    if (-not $Issue91PkgWillChange -and $pfPkg.PSObject.Properties.Name -contains "scripts" -and $pfPkg.scripts) {
      foreach ($s in $Issue91ToolkitScripts) {
        if ($pfPkg.scripts.PSObject.Properties.Name -contains $s) {
          $v = $pfPkg.scripts.$s
          if ($v -and $v -match "node\s+scripts/(ask-gpt|ask-gemini)\.js") { $Issue91PkgWillChange = $true; break }
        }
      }
    }
  } catch {
    # Unparseable package.json - the migration block will leave it alone too
  }
}
if ($Issue91PkgWillChange) {
  $PfMigrations += "package.json cleanup (issue #91): toolkit deps/scripts removed from your package.json (backed up first)"
}

# Managed files that differ from the incoming version. The enumeration
# below mirrors the copy blocks exactly: every file setup overwrites via
# Invoke-SafeCopy is compared here, nothing else.
foreach ($src in Get-ChildItem -Path $CommandsDir -Filter *.md -File) {
  Add-PreflightDiff -Source $src.FullName -Rel (Join-Path ".claude\commands" $src.Name)
}
$pfSharedDir = Join-Path $ToolkitRoot ".claude\skills\shared"
if (Test-Path -LiteralPath $pfSharedDir -PathType Container) {
  foreach ($src in Get-ChildItem -Path $pfSharedDir -Filter *.md -File) {
    Add-PreflightDiff -Source $src.FullName -Rel (Join-Path ".claude\skills\shared" $src.Name)
  }
}
$pfShellsDir = Join-Path $ToolkitRoot ".claude\skills\shared\shells"
if (Test-Path -LiteralPath $pfShellsDir -PathType Container) {
  foreach ($src in Get-ChildItem -Path $pfShellsDir -File) {
    Add-PreflightDiff -Source $src.FullName -Rel (Join-Path ".claude\skills\shared\shells" $src.Name)
  }
}
$pfSkillsRoot = Join-Path $ToolkitRoot ".claude\skills"
if (Test-Path -LiteralPath $pfSkillsRoot -PathType Container) {
  foreach ($skillDir in Get-ChildItem -Path $pfSkillsRoot -Directory) {
    if ($skillDir.Name -eq "shared") { continue }
    foreach ($src in Get-ChildItem -Path $skillDir.FullName -File) {
      Add-PreflightDiff -Source $src.FullName -Rel (Join-Path ".claude\skills" (Join-Path $skillDir.Name $src.Name))
    }
  }
}
foreach ($pfName in @("ask-gpt.js", "ask-gemini.js", "browse.js", "package.json", "generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js")) {
  Add-PreflightDiff -Source (Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $pfName)) -Rel (Join-Path ".claude\scripts" $pfName)
}
$pfLockSrc = Join-Path $ToolkitRoot ".claude\scripts\package-lock.json"
if (Test-Path -LiteralPath $pfLockSrc -PathType Leaf) {
  Add-PreflightDiff -Source $pfLockSrc -Rel ".claude\scripts\package-lock.json"
}
Add-PreflightDiff -Source (Join-Path $ToolkitRoot ".env.local.example") -Rel ".env.local.example"
Add-PreflightDiff -Source (Join-Path $ToolkitRoot ".gitattributes") -Rel ".gitattributes"
Add-PreflightDiff -Source (Join-Path $ToolkitRoot "artifacts\README.md") -Rel "artifacts\README.md"
Add-PreflightDiff -Source (Join-Path $ToolkitRoot ".claude\rules\toolkit.md") -Rel ".claude\rules\toolkit.md" -IgnoreVersionStamp
Add-PreflightDiff -Source (Join-Path $ToolkitRoot ".claude\rules\html-outputs.md") -Rel ".claude\rules\html-outputs.md" -IgnoreVersionStamp
# VERSION is compared only on a fresh install: on upgrade it always
# differs (that is the version gap, reported above), but a fresh target
# carrying its own unrelated VERSION file is about to lose it. On
# upgrade it still joins ManagedRels so the manifest keeps tracking it.
if (-not $IsUpgrade) {
  Add-PreflightDiff -Source (Join-Path $ToolkitRoot "VERSION") -Rel "VERSION"
} else {
  $script:ManagedRels += "VERSION"
}

# Custom files in toolkit-managed directories. Anything listed here is
# NOT shipped by the toolkit and setup NEVER modifies or deletes it:
# the copy loops only write files that exist in the toolkit source, and
# the migration blocks only touch the specific legacy paths inventoried
# above. node_modules\ (created by npm install under .claude\scripts\)
# is skipped - it is machine-generated, not a customization.
$PfCustom = @()
$pfMigrationTargets = @($RenamedFiles | ForEach-Object { $_.Old })
foreach ($pfName in $LegacyCommands) {
  $pfMigrationTargets += (Join-Path ".claude\commands" $pfName)
}
$pfPrefix = $Target
if (-not $pfPrefix.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
  $pfPrefix = $pfPrefix + [System.IO.Path]::DirectorySeparatorChar
}
foreach ($pfDirName in @("commands", "rules", "scripts", "skills")) {
  $pfDir = Join-Path $Target (Join-Path ".claude" $pfDirName)
  if (-not (Test-Path -LiteralPath $pfDir -PathType Container)) { continue }
  foreach ($pfFile in Get-ChildItem -Path $pfDir -Recurse -File -Force) {
    if ($pfFile.FullName -match '[\\/]node_modules[\\/]') { continue }
    $pfRel = $pfFile.FullName
    if ($pfRel.StartsWith($pfPrefix)) { $pfRel = $pfRel.Substring($pfPrefix.Length) }
    if ($pfMigrationTargets -contains $pfRel) { continue }
    if (-not (Test-Path -LiteralPath (Join-Path $ToolkitRoot $pfRel) -PathType Leaf)) {
      $PfCustom += $pfRel
    }
  }
}

# Stale backup directories from earlier runs (issue #133 evidence: these
# linger in project roots for years without anyone noticing).
$PfStaleBackups = @(Get-ChildItem -Path $Target -Directory -Force -Filter ".toolkit-backup-*" -ErrorAction SilentlyContinue).Count

Write-Host "  ----------------------------------------"
Write-Host "   Pre-flight report (no changes made yet)"
Write-Host "  ----------------------------------------"
Write-Host ""
if ($IsUpgrade) {
  if ($OldVersion -and $OldVersion -ne $Version) {
    Write-Host "    Install type: upgrade (v$OldVersion -> v$Version)"
  } elseif ($OldVersion) {
    Write-Host "    Install type: re-run of v$Version"
  } else {
    Write-Host "    Install type: upgrade (pre-VERSION install -> v$Version)"
  }
} else {
  Write-Host "    Install type: fresh install (v$Version)"
}
Write-Host ""
Write-Host "    Migrations that will run:"
if ($PfMigrations.Count -gt 0) {
  foreach ($pfLine in $PfMigrations) { Write-Host "      - $pfLine" }
} else {
  Write-Host "      (none)"
}
Write-Host ""
Write-Host "    Managed toolkit files that differ from the incoming version"
Write-Host "    (will be overwritten - your current copy is backed up first):"
if ($script:PfDiffs.Count -gt 0) {
  foreach ($pfLine in $script:PfDiffs) { Write-Host "      - $pfLine" }
} else {
  Write-Host "      (none - your managed files match the incoming ones)"
}
Write-Host ""
Write-Host "    Custom files detected in toolkit-managed directories"
Write-Host "    (not shipped by the toolkit - setup will NOT modify or delete them):"
if ($PfCustom.Count -gt 0) {
  foreach ($pfLine in $PfCustom) { Write-Host "      - $pfLine" }
} else {
  Write-Host "      (none)"
}
Write-Host ""
Write-Host "    Backups: anything this run overwrites or deletes is copied first to"
Write-Host "      $($script:BackupDir)"
if ($PfStaleBackups -gt 0) {
  Write-Host ""
  Write-Host "    Note: $PfStaleBackups older .toolkit-backup-* folder(s) from previous runs are"
  Write-Host "    still in the project root. Delete them when no longer needed."
}
Write-Host ""

if ($DryRun) {
  Write-Host "  Dry run complete - no files were created, modified, or deleted."
  Write-Host ""
  exit 0
}

# --- Overwrite gate (issue #138) -------------------------------
# Runs after the pre-flight report and the -DryRun exit, BEFORE the
# first filesystem write. Files classified LOCALLY MODIFIED above carry
# the user's own edits; silently replacing them is the one destructive
# thing the installer could still do. Interactive runs get a confirm
# prompt; non-interactive hosts abort and point at -Force instead of
# hanging on Read-Host. Either way each file is backed up before being
# overwritten. Mirrors the overwrite gate in setup.sh.
if ($script:PfModified.Count -gt 0 -and -not $Force) {
  Write-Host "  $($script:PfModified.Count) locally modified file(s) will be overwritten (backups made):"
  foreach ($rel in $script:PfModified) {
    Write-Host "    - $rel"
  }
  Write-Host ""
  $proceed = $false
  # Only prompt when a human can actually answer. Redirected stdin or a
  # non-interactive host must take the abort path, not block forever.
  $canPrompt = $true
  try {
    if ([Console]::IsInputRedirected) { $canPrompt = $false }
  } catch {
    $canPrompt = $false
  }
  if ($canPrompt -and -not [Environment]::UserInteractive) { $canPrompt = $false }
  if ($canPrompt) {
    try {
      $answer = Read-Host "  Continue? [y/N]"
      if ($answer -match '^(?i)(y|yes)$') { $proceed = $true }
    } catch {
      $proceed = $false
    }
    if (-not $proceed) {
      Write-Host ""
      Write-Host "  Aborted - no files were created, modified, or deleted."
      Write-Host "  Re-run with -Force added to the arguments (setup.ps1 -Target <target> -Force)"
      Write-Host "  to skip this prompt; each file is backed up first."
      Write-Host ""
      exit 1
    }
  } else {
    Write-Host "  Not running interactively, so setup cannot ask for confirmation."
    Write-Host "  Re-run with -Force added to the arguments (setup.ps1 -Target <target> -Force);"
    Write-Host "  each file is backed up first."
    Write-Host ""
    exit 1
  }
}

New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\rules") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\scripts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\skills") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target "plans") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target "artifacts") | Out-Null

# --- Backup helpers (issue #79) --------------------------------
# Before overwriting or deleting any file in the target, copy the original
# to a timestamped backup directory at the target root. The directory name
# is fixed in the pre-flight section above (so the report can announce it
# up front); it is only created on the first backup, so clean installs and
# identical re-runs leave no empty backup dir behind. All backups in one
# setup run share the same directory.
$script:BackupCount = 0

# Backup-File: copy a target-resident file into the backup root, mirroring
# its relative path. $script:BackupDir carries $PID so two same-second
# runs get distinct backup dirs (avoids silent overwrite of a prior run's
# backups).
function Backup-File {
  param([string]$Original)
  # Compute path relative to $Target so the backup mirrors the layout
  $rel = $Original
  $prefix = $Target
  if (-not $prefix.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $prefix = $prefix + [System.IO.Path]::DirectorySeparatorChar
  }
  if ($rel.StartsWith($prefix)) {
    $rel = $rel.Substring($prefix.Length)
  }
  $dest = Join-Path $script:BackupDir $rel
  $destParent = Split-Path -Parent $dest
  # New-Item -Force is the PowerShell equivalent of mkdir -p
  New-Item -ItemType Directory -Force -Path $destParent | Out-Null
  Copy-Item -LiteralPath $Original -Destination $dest -Force
  $script:BackupCount = $script:BackupCount + 1
}

# Invoke-SafeCopy: copy src to dst. If dst exists and differs, back it up
# first. If dst is byte-identical to src, skip entirely (preserves mtime,
# keeps re-runs clean). Byte comparison matches the bash `cmp -s` behavior.
# Symlinks are backed up as links (not their targets) and removed before
# the new file is written - prevents Copy-Item from writing through a link
# and modifying the user's real target file.
function Invoke-SafeCopy {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (Test-Path -LiteralPath $Destination) {
    $item = Get-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    if ($item -and $item.LinkType) {
      Backup-File -Original $Destination
      Remove-Item -LiteralPath $Destination -Force
    } elseif (Test-Path -LiteralPath $Destination -PathType Leaf) {
      # Length check first - cheap short-circuit when sizes differ
      $srcInfo = Get-Item -LiteralPath $Source
      $dstInfo = Get-Item -LiteralPath $Destination
      if ($srcInfo.Length -eq $dstInfo.Length) {
        $srcBytes = [System.IO.File]::ReadAllBytes($Source)
        $dstBytes = [System.IO.File]::ReadAllBytes($Destination)
        $identical = $true
        for ($i = 0; $i -lt $srcBytes.Length; $i++) {
          if ($srcBytes[$i] -ne $dstBytes[$i]) { $identical = $false; break }
        }
        if ($identical) { return }
      }
      Backup-File -Original $Destination
    }
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Force
}

$Skipped = @()

# --- Legacy cleanup (v3.4 -> v3.5 migration) -------------------
# Commands that became skills in v3.5 (the $LegacyCommands list lives in
# the migration inventory above, shared with the pre-flight report).
# Delete old command files BEFORE copying new ones to avoid name conflicts.
# Mirrors the LEGACY_COMMANDS block in setup.sh; added in issue #133 -
# setup.ps1 has copied command files since the v3.4 era too, so Windows
# upgrades could carry the same stale command files this block removes.
$LegacyCleaned = 0
foreach ($fname in $LegacyCommands) {
  $oldPath = Join-Path $Target (Join-Path ".claude\commands" $fname)
  if (Test-Path -LiteralPath $oldPath -PathType Leaf) {
    Backup-File -Original $oldPath
    Remove-Item -LiteralPath $oldPath -Force
    $LegacyCleaned = $LegacyCleaned + 1
  }
}
if ($LegacyCleaned -gt 0) {
  Write-Host "  Cleaned up $LegacyCleaned legacy command file(s) (now skills)"
}

# --- Renamed files cleanup (issue #80) ----------------------
# When a toolkit file is renamed upstream (e.g. dev-lead-gpt.md -> ask-gpt.md),
# copying the new name is not enough: the old file sticks around and still
# loads as a stale slash command. The $RenamedFiles list lives in the
# migration inventory above (shared with the pre-flight report).
# Backup-File preserves any customizations the user made to the
# old-named file before Remove-Item removes it.
$RenamedCleaned = 0
foreach ($r in $RenamedFiles) {
  $oldPath = Join-Path $Target $r.Old
  if (Test-Path -LiteralPath $oldPath -PathType Leaf) {
    Backup-File -Original $oldPath
    Remove-Item -LiteralPath $oldPath -Force
    Write-Host "  Removed renamed file: $($r.Old) -> $($r.New)"
    $RenamedCleaned = $RenamedCleaned + 1
  }
}
if ($RenamedCleaned -gt 0) {
  Write-Host "  Cleaned up $RenamedCleaned renamed file(s)"
}

# --- Issue #91 migration (v4.2 -> v4.3): toolkit deps in target package.json ---
# In v4.2.x and earlier, toolkit deps (openai, @google/generative-ai,
# playwright-core, @axe-core/playwright) were installed at the project root,
# and runtime scripts lived at scripts\*.js. End users cloning the downstream
# project pulled toolkit deps they didn't need (issue #91). v4.3 quarantines
# both under .claude\scripts\. This block detects the old layout and cleans
# up. Runs BEFORE the copy block so old scripts are backed up before new ones
# land at .claude\scripts\.
#
# Cross-reference: setup.sh has the canonical Bash version of this same
# logic. If you change the deps list, the script regex, or the migration
# message here, update setup.sh in lockstep so Bash and PowerShell users
# get identical behavior. The $Issue91OldScripts / $Issue91ToolkitDeps /
# $Issue91ToolkitScripts lists live in the migration inventory above
# (shared with the pre-flight report).
$Issue91ScriptsRemoved = 0
foreach ($oldRel in $Issue91OldScripts) {
  $oldPath = Join-Path $Target $oldRel
  if (Test-Path -LiteralPath $oldPath -PathType Leaf) {
    Backup-File -Original $oldPath
    Remove-Item -LiteralPath $oldPath -Force
    $Issue91ScriptsRemoved = $Issue91ScriptsRemoved + 1
  }
}

# Remove leaked toolkit deps and convenience scripts from $Target\package.json.
# The four deps are toolkit-owned and always safe to remove. The two
# convenience scripts are recognized only when their command body still
# points at the OLD `scripts/<name>.js` path so we don't clobber a script
# the user customized to do something else under the same name.
$Issue91PkgTouched = 0
$pkgPath = Join-Path $Target "package.json"
if (Test-Path -LiteralPath $pkgPath -PathType Leaf) {
  try {
    $pkgRaw = Get-Content -LiteralPath $pkgPath -Raw
    $pkg = $pkgRaw | ConvertFrom-Json
    $touched = $false
    if ($pkg.PSObject.Properties.Name -contains "dependencies" -and $pkg.dependencies) {
      foreach ($dep in $Issue91ToolkitDeps) {
        if ($pkg.dependencies.PSObject.Properties.Name -contains $dep) {
          $pkg.dependencies.PSObject.Properties.Remove($dep)
          $touched = $true
        }
      }
      if (($pkg.dependencies.PSObject.Properties | Measure-Object).Count -eq 0) {
        $pkg.PSObject.Properties.Remove("dependencies")
      }
    }
    if ($pkg.PSObject.Properties.Name -contains "scripts" -and $pkg.scripts) {
      foreach ($s in $Issue91ToolkitScripts) {
        if ($pkg.scripts.PSObject.Properties.Name -contains $s) {
          $v = $pkg.scripts.$s
          if ($v -and $v -match "node\s+scripts/(ask-gpt|ask-gemini)\.js") {
            $pkg.scripts.PSObject.Properties.Remove($s)
            $touched = $true
          }
        }
      }
      if (($pkg.scripts.PSObject.Properties | Measure-Object).Count -eq 0) {
        $pkg.PSObject.Properties.Remove("scripts")
      }
    }
    if ($touched) {
      Backup-File -Original $pkgPath
      $newJson = ConvertTo-Json $pkg -Depth 100
      # Write as UTF-8 WITHOUT a BOM. Windows PowerShell 5.1 (the system
      # default on Windows) writes UTF-8-with-BOM via Set-Content; some npm
      # versions and bundlers reject a BOM-prefixed package.json. Use the
      # .NET API to force consistent BOM-less UTF-8 across PS 5.1 and 7+.
      $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
      [System.IO.File]::WriteAllText($pkgPath, $newJson + "`n", $utf8NoBom)
      $Issue91PkgTouched = 1
    }
  } catch {
    # If JSON parsing or editing fails, leave the file alone
  }
}

if ($Issue91ScriptsRemoved -gt 0 -or $Issue91PkgTouched -gt 0) {
  Write-Host "  Migrated v4.2 -> v4.3 toolkit dep layout (issue #91):"
  if ($Issue91ScriptsRemoved -gt 0) {
    Write-Host "    - Removed $Issue91ScriptsRemoved old script(s) from $Target\scripts\"
  }
  if ($Issue91PkgTouched -gt 0) {
    Write-Host "    - Cleaned toolkit deps and convenience scripts from $Target\package.json"
  }
  Write-Host "    Run 'npm install --prefix .claude\scripts' to install the deps in the new location."
}

# --- Command files (upstream-owned - Invoke-SafeCopy backs up any customizations) ---
Write-Host "  Copying .claude\commands\ ..."
foreach ($src in Get-ChildItem -Path $CommandsDir -Filter *.md -File) {
  $dest = Join-Path $Target (Join-Path ".claude\commands" $src.Name)
  try {
    Invoke-SafeCopy -Source $src.FullName -Destination $dest
  } catch {
    Write-Host "  Error: Failed to copy $($src.Name): $_"
    exit 1
  }
}

# --- Skill files (upstream-owned - always copy; mirrors setup.sh) ---
# Added in issue #113. Previously setup.ps1 did not copy .claude\skills\
# at all, so Windows users never received review skills or shared reference
# files (output-template.md, severity-anchors.md, html-look.md, etc.).
# This block mirrors the setup.sh skills loop: copy shared\ first, then
# iterate each skill directory.
Write-Host "  Copying .claude\skills\ ..."

# Copy shared supporting files first
$sharedDir = Join-Path $ToolkitRoot ".claude\skills\shared"
if (Test-Path -LiteralPath $sharedDir -PathType Container) {
  $sharedDest = Join-Path $Target ".claude\skills\shared"
  New-Item -ItemType Directory -Force -Path $sharedDest | Out-Null
  foreach ($src in Get-ChildItem -Path $sharedDir -Filter *.md -File) {
    $dest = Join-Path $sharedDest $src.Name
    try {
      Invoke-SafeCopy -Source $src.FullName -Destination $dest
    } catch {
      Write-Host "  Error: Failed to copy shared\$($src.Name): $_"
      exit 1
    }
  }
}

# PARITY: shared\shells\ must be copied by BOTH setup.sh and setup.ps1 (issue #126).
# The shared loop above copies ONLY *.md, and the per-skill loop below SKIPS
# shared - so this prebuilt-shell subdirectory (the *.html shells + tokens.css
# that render-html.js injects into) needs its own copy step. Copy every file in
# the directory (the shells are *.html plus tokens.css); -File excludes any
# nested directories. Mirrors the shells block in setup.sh.
$shellsDir = Join-Path $ToolkitRoot ".claude\skills\shared\shells"
if (Test-Path -LiteralPath $shellsDir -PathType Container) {
  $shellsDest = Join-Path $Target ".claude\skills\shared\shells"
  New-Item -ItemType Directory -Force -Path $shellsDest | Out-Null
  foreach ($src in Get-ChildItem -Path $shellsDir -File) {
    $dest = Join-Path $shellsDest $src.Name
    try {
      Invoke-SafeCopy -Source $src.FullName -Destination $dest
    } catch {
      Write-Host "  Error: Failed to copy shared\shells\$($src.Name): $_"
      exit 1
    }
  }
}

# Copy each skill directory (contains SKILL.md and optional supporting files)
$skillsRoot = Join-Path $ToolkitRoot ".claude\skills"
if (Test-Path -LiteralPath $skillsRoot -PathType Container) {
  foreach ($skillDir in Get-ChildItem -Path $skillsRoot -Directory) {
    if ($skillDir.Name -eq "shared") { continue }
    Write-Host "    $($skillDir.Name)"
    $skillDest = Join-Path $Target (Join-Path ".claude\skills" $skillDir.Name)
    New-Item -ItemType Directory -Force -Path $skillDest | Out-Null
    foreach ($src in Get-ChildItem -Path $skillDir.FullName -File) {
      $dest = Join-Path $skillDest $src.Name
      try {
        Invoke-SafeCopy -Source $src.FullName -Destination $dest
      } catch {
        Write-Host "  Error: Failed to copy $($skillDir.Name)\$($src.Name): $_"
        exit 1
      }
    }
  }
}

# --- Runtime scripts and quarantined package.json (issue #91) ---
# Runtime scripts and their deps live under .claude\scripts\ so they don't
# leak into the downstream project's root package.json. Setup scripts stay
# in the toolkit repo and are not copied to the target.
Write-Host "  Copying .claude\scripts\ runtime files ..."
$runtimeFiles = @("ask-gpt.js", "ask-gemini.js", "browse.js", "package.json")
foreach ($name in $runtimeFiles) {
  try {
    $src = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $name)
    $dest = Join-Path $Target (Join-Path ".claude\scripts" $name)
    Invoke-SafeCopy -Source $src -Destination $dest
  } catch {
    Write-Host "  Error: Failed to copy $name : $_"
    exit 1
  }
}
# Lockfile is optional - shipping it gives reproducible installs but if the
# toolkit author hasn't committed one yet, don't fail.
$lockSrc = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" "package-lock.json")
if (Test-Path -LiteralPath $lockSrc -PathType Leaf) {
  try {
    $lockDest = Join-Path $Target (Join-Path ".claude\scripts" "package-lock.json")
    Invoke-SafeCopy -Source $lockSrc -Destination $lockDest
  } catch {
    Write-Host "  Error: Failed to copy package-lock.json : $_"
    exit 1
  }
}

# PARITY: .claude\scripts\ files must be copied by BOTH setup.sh and setup.ps1.
# Add a new script to one installer? Add it to the other too (issue #126).
# Dep-free runtime scripts: copied separately from the issue-#91 quarantine
# group above (which carries scripts that need node_modules). Mirrors setup.sh.
# render-html.js injects a JSON payload into a prebuilt shell under
# .claude\skills\shared\shells\ (copied with the skills block above).
Write-Host "  Copying .claude\scripts\ dep-free scripts (generate-index.js, open-artifact.sh, render-html.js, session-init.js) ..."
foreach ($name in @("generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js")) {
  try {
    $src = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $name)
    $dest = Join-Path $Target (Join-Path ".claude\scripts" $name)
    Invoke-SafeCopy -Source $src -Destination $dest
  } catch {
    Write-Host "  Error: Failed to copy $name : $_"
    exit 1
  }
}

# --- .env.local.example (template - Invoke-SafeCopy backs up local edits) ---
Write-Host "  Copying .env.local.example ..."
try {
  Invoke-SafeCopy -Source (Join-Path $ToolkitRoot ".env.local.example") -Destination (Join-Path $Target ".env.local.example")
} catch {
  Write-Host "  Error: Failed to copy .env.local.example : $_"
  exit 1
}

# ─── .gitignore (merge - preserve user entries, add toolkit lines) ─
$gitignoreSrc = Join-Path $ToolkitRoot ".gitignore"
$gitignoreDest = Join-Path $Target ".gitignore"
if (Test-Path -LiteralPath $gitignoreDest -PathType Leaf) {
  Write-Host "  Merging .gitignore (preserving your entries) ..."
  $existingLines = Get-Content -LiteralPath $gitignoreDest
  $sourceLines = Get-Content -LiteralPath $gitignoreSrc
  foreach ($line in $sourceLines) {
    # Skip blank lines and comments to avoid accumulating duplicates on repeated runs
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) { continue }
    if ($existingLines -notcontains $line) {
      Add-Content -LiteralPath $gitignoreDest -Value $line
    }
  }
} else {
  Write-Host "  Copying .gitignore ..."
  try {
    Copy-Item -LiteralPath $gitignoreSrc -Destination $gitignoreDest -Force
  } catch {
    Write-Host "  Error: Failed to copy .gitignore: $_"
    exit 1
  }
}

# --- .gitattributes (upstream-owned - Invoke-SafeCopy handles any customizations) ---
Write-Host "  Copying .gitattributes ..."
try {
  Invoke-SafeCopy -Source (Join-Path $ToolkitRoot ".gitattributes") -Destination (Join-Path $Target ".gitattributes")
} catch {
  Write-Host "  Error: Failed to copy .gitattributes: $_"
  exit 1
}

# --- VERSION (upstream-owned; parity with setup.sh, issue #133) ---
# setup.ps1 historically never wrote VERSION into the target, so Windows
# installs could not report a version gap on upgrade. Mirrors setup.sh.
Write-Host "  Copying VERSION ..."
try {
  Invoke-SafeCopy -Source (Join-Path $ToolkitRoot "VERSION") -Destination (Join-Path $Target "VERSION")
} catch {
  Write-Host "  Error: Failed to copy VERSION: $_"
  exit 1
}

# --- Toolkit rules (upstream-owned - Invoke-SafeCopy handles any customizations) ---
Write-Host "  Copying .claude\rules\toolkit.md ..."
$toolkitRuleSrc = Join-Path $ToolkitRoot ".claude\rules\toolkit.md"
$toolkitRuleDest = Join-Path $Target ".claude\rules\toolkit.md"
try {
  Invoke-SafeCopy -Source $toolkitRuleSrc -Destination $toolkitRuleDest
} catch {
  Write-Host "  Error: Failed to copy toolkit.md: $_"
  exit 1
}
# Stamp the installed version into toolkit.md so users can check it later
$content = Get-Content -LiteralPath $toolkitRuleDest -Raw
$content = $content -replace '<!-- This file is managed by the LLM Peer Review toolkit\.', "<!-- Toolkit version: $Version | Managed by LLM Peer Review."
Set-Content -LiteralPath $toolkitRuleDest -Value $content -NoNewline

# --- HTML output rules (issue #113, mirror of toolkit.md handling) ---
# Same stamp pattern as toolkit.md. Source ships pre-stamped via
# bump-version.sh; this -replace is a no-op on stamped files and harmless
# on re-runs.
Write-Host "  Copying .claude\rules\html-outputs.md ..."
$htmlRuleSrc = Join-Path $ToolkitRoot ".claude\rules\html-outputs.md"
$htmlRuleDest = Join-Path $Target ".claude\rules\html-outputs.md"
try {
  Invoke-SafeCopy -Source $htmlRuleSrc -Destination $htmlRuleDest
} catch {
  Write-Host "  Error: Failed to copy html-outputs.md: $_"
  exit 1
}
$htmlContent = Get-Content -LiteralPath $htmlRuleDest -Raw
$htmlContent = $htmlContent -replace '<!-- This file is managed by the LLM Peer Review toolkit\.', "<!-- Toolkit version: $Version | Managed by LLM Peer Review."
Set-Content -LiteralPath $htmlRuleDest -Value $htmlContent -NoNewline

# --- artifacts/ scaffold (issue #113, mirror of setup.sh) ---
# The HTML-output feature writes to artifacts\html\ in the target project.
# Ship the tracked README so the directory is discoverable and the gitignored
# html\ subdir has a home. Invoke-SafeCopy backs up any user customization.
Write-Host "  Copying artifacts\README.md ..."
$artifactsReadmeSrc = Join-Path $ToolkitRoot "artifacts\README.md"
$artifactsReadmeDest = Join-Path $Target "artifacts\README.md"
try {
  Invoke-SafeCopy -Source $artifactsReadmeSrc -Destination $artifactsReadmeDest
} catch {
  Write-Host "  Error: Failed to copy artifacts\README.md: $_"
  exit 1
}

# Capture whether LESSONS.md predates this run BEFORE the loop copies it, so the paired
# LESSONS-detail.md is only seeded on a genuinely fresh install (see the block below).
$LessonsPreexisted = Test-Path -LiteralPath (Join-Path $Target "LESSONS.md") -PathType Leaf

foreach ($f in @("CLAUDE.md", "LESSONS.md", ".claude\settings.local.json")) {
  $src = Join-Path $ToolkitRoot $f
  $dest = Join-Path $Target $f
  if (Test-Path -LiteralPath $dest -PathType Leaf) {
    Write-Host "  Skipping $f - already exists (yours to customize)"
    $Skipped += $f
  } else {
    Write-Host "  Copying $f ..."
    try {
      Copy-Item -LiteralPath $src -Destination $dest -Force
    } catch {
      Write-Host "  Error: Failed to copy $f : $_"
      exit 1
    }
  }
}

# ─── LESSONS-detail.md (paired with the LESSONS.md index) ────
# LESSONS.md is the short index Claude reads each session; LESSONS-detail.md holds the full
# write-ups it opens on demand. Only SEED the detail file on a fresh install (LESSONS.md did
# not already exist). On upgrade, an existing flat LESSONS.md is preserved and we must NOT
# drop a mismatched detail file beside it - the session-start read treats a missing detail
# file as "LESSONS.md is the older flat format" and reads it whole instead.
$lessonsDetailDest = Join-Path $Target "LESSONS-detail.md"
if ($LessonsPreexisted) {
  if (Test-Path -LiteralPath $lessonsDetailDest -PathType Leaf) {
    Write-Host "  Skipping LESSONS-detail.md - already exists (yours to customize)"
    $Skipped += "LESSONS-detail.md"
  } else {
    Write-Host "  Note: your LESSONS.md predates the index/detail split - it still works as-is."
    Write-Host "        To enable on-demand loading, ask Claude to split it into LESSONS.md (index) + LESSONS-detail.md."
  }
} elseif (-not (Test-Path -LiteralPath $lessonsDetailDest -PathType Leaf)) {
  Write-Host "  Copying LESSONS-detail.md ..."
  try {
    Copy-Item -LiteralPath (Join-Path $ToolkitRoot "LESSONS-detail.md") -Destination $lessonsDetailDest -Force
  } catch {
    Write-Host "  Error: Failed to copy LESSONS-detail.md : $_"
    exit 1
  }
}

# --- Toolkit manifest (issue #138) -----------------------------
# Wholesale-regenerated on every real run (never on -DryRun, which exits
# above). Records the EOL-normalized sha256 of every managed file exactly
# as this run left it on disk - i.e. AFTER the version-stamp rewrites of
# the two rules files - so stamped files never self-flag on the next run.
# User-owned skip-if-exists files (CLAUDE.md, LESSONS.md,
# LESSONS-detail.md, .claude\settings.local.json) and the line-merged
# .gitignore are NOT tracked: setup never overwrites those, so they need
# no gate. ManagedRels is accumulated by the pre-flight enumeration,
# which mirrors the copy blocks exactly. Forward-slash keys and BOM-less
# UTF-8 with LF newlines keep it portable with setup.sh.
$manifestEntries = @()
foreach ($rel in $script:ManagedRels) {
  $p = Join-Path $Target $rel
  # Tolerate conditionally-shipped files (e.g. package-lock.json) that
  # were enumerated but not written this run.
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
  $h = Get-ToolkitFileHash -Path $p
  $manifestEntries += "    `"$($rel.Replace('\', '/'))`": `"$h`""
}
$manifestBody = "{`n"
$manifestBody += "  `"toolkitVersion`": `"$Version`",`n"
$manifestBody += "  `"files`": {`n"
$manifestBody += ($manifestEntries -join ",`n") + "`n"
$manifestBody += "  }`n"
$manifestBody += "}`n"
$manifestUtf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($script:ManifestPath, $manifestBody, $manifestUtf8NoBom)
Write-Host "  Wrote .claude\.toolkit-manifest.json ($($manifestEntries.Count) managed file(s) tracked)"

Write-Host ""
Write-Host "  ================================"
Write-Host "   Done"
Write-Host "  ================================"
Write-Host ""

# --- Backup summary (issue #79) --------------------------------
# Only printed when at least one file was backed up. Clean installs and
# identical re-runs stay silent.
if ($script:BackupCount -gt 0) {
  Write-Host "    Backed up $($script:BackupCount) file(s) to:"
  Write-Host "      $($script:BackupDir)"
  Write-Host ""
  Write-Host "    New in v4.2 - setup now preserves any file it would overwrite"
  Write-Host "    or delete. If you customized a toolkit file, your original is"
  Write-Host "    safe in the directory above. Delete when you are done."
  Write-Host ""
}

# --- Locally modified files summary (issue #138) ---------------
# Printed when this run overwrote files the manifest flagged as locally
# modified (the user confirmed the gate or passed -Force). Each line
# pairs the file with its backup so re-applying local changes is a
# checklist, not an archaeology dig. Mirrors the block in setup.sh.
if ($script:PfModified.Count -gt 0) {
  Write-Host "    Locally modified file(s) replaced with stock versions:"
  foreach ($rel in $script:PfModified) {
    Write-Host "      - $rel"
    Write-Host "        backup: $(Join-Path $script:BackupDir $rel)"
  }
  Write-Host ""
  Write-Host "    Re-apply your changes from the backups above if you still need them."
  Write-Host ""
}

if ($Skipped.Count -gt 0) {
  Write-Host "    Skipped (already existed - not overwritten):"
  foreach ($f in $Skipped) {
    Write-Host "      - $f"
  }
  Write-Host ""
  Write-Host "    To refresh a skipped file: delete it and rerun this script."
  Write-Host ""
}

# --- New-this-version announcement (upgrades only) -----------
# Fires on any upgrade so a plain version bump no longer lands silently.
# Mirrors the Bash block in setup.sh. setup.ps1 has no LEGACY_CLEANED /
# PLANS_MIGRATED counters, so the gate is just $IsUpgrade.
if ($IsUpgrade) {
  Write-Host "    +------------------------------------------------+"
  Write-Host "    |  Upgraded to v$Version - new this version:        |"
  Write-Host "    +------------------------------------------------+"
  Write-Host ""
  Write-Host "      - HTML viewing for human-read outputs."
  Write-Host "        /create-plan and /document now render an HTML view"
  Write-Host "        alongside markdown. /review-* and /ask-* may render"
  Write-Host "        HTML when a finding count or severity mix justifies it."
  Write-Host "        Markdown stays canonical; HTML is additive."
  Write-Host ""
  Write-Host "      - NEW: /audit-html scans your project's own markdown"
  Write-Host "        for files that would benefit from an HTML view."
  Write-Host "        Report-only; opt-in for static view generation."
  Write-Host ""
  Write-Host "      See .claude\rules\html-outputs.md and CHANGELOG.md."
  Write-Host ""
}

Write-Host "    What to do next:"
Write-Host ""
Write-Host "      cd $Target"
Write-Host ""
Write-Host "      1. Install the toolkit's runtime packages."
Write-Host "         (Stays inside .claude\scripts\. Your project's"
Write-Host "         package.json is not touched.)"
Write-Host "           npm install --prefix .claude\scripts"
Write-Host ""
Write-Host "      2. Set up your API keys:"
Write-Host "           Copy-Item .env.local.example .env.local"
Write-Host "         Then open .env.local and paste:"
Write-Host "           OPENAI_API_KEY  ->  https://platform.openai.com/api-keys"
Write-Host "           GEMINI_API_KEY  ->  https://aistudio.google.com/apikey"
Write-Host ""
Write-Host "      3. Open the folder in Cursor and run /explore to start your first workflow."
Write-Host ""
Write-Host "      4. (Optional) Install Chromium for /review-browser:"
Write-Host "           npx --prefix .claude\scripts playwright-core install chromium"
Write-Host ""
Write-Host "      5. (Optional) Try /audit-html. It scans your project's"
Write-Host "         own markdown for files that would benefit from an"
Write-Host "         HTML view. Toolkit outputs (plans, reviews, debates)"
Write-Host "         already render HTML automatically."
Write-Host ""
Write-Host "      Steps 1-4 are optional. Skip 1-2 if you don't need"
Write-Host "      /ask-gpt or /ask-gemini. Skip 4 if you don't need"
Write-Host "      /review-browser. Skip 5 if your project has no long"
Write-Host "      human-read markdown."
Write-Host ""
Write-Host "    Tip: To update commands and scripts, run setup again from"
Write-Host "    the toolkit repo: powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Target `"$Target`""
Write-Host ""
