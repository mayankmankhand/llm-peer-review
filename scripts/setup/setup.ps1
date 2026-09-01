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

# Check dep-free runtime scripts (index generator + artifact opener + HTML renderer + session-init + pre-push tripwire + correction ledger) - must exist.
foreach ($f in @("generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js", "pre-push-check.js", "correction-ledger.js")) {
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
# forward-slash relative path. $script:ManifestPresent records whether
# the FILE exists, independent of whether it parsed: Add-PreflightDiff
# below treats "manifest present, no entry" differently from "no
# manifest at all", and setup.sh (which greps the file rather than
# parsing it) draws that line on file presence too. An unreadable
# manifest therefore yields no entries but still counts as present, so
# every differing file is gated (the safe side) - never a hard failure.
$script:ManifestHashes = @{}
$script:ManifestPresent = Test-Path -LiteralPath $script:ManifestPath -PathType Leaf
if ($script:ManifestPresent) {
  try {
    $mf = (Get-Content -LiteralPath $script:ManifestPath -Raw) | ConvertFrom-Json
    if ($mf.PSObject.Properties.Name -contains "files" -and $mf.files) {
      foreach ($prop in $mf.files.PSObject.Properties) {
        $script:ManifestHashes[$prop.Name] = $prop.Value
      }
    }
  } catch {
    # Corrupt or hand-edited manifest - no entries, so every differing
    # managed file is classified LOCALLY MODIFIED and gated below
  }
}

# Add-PreflightDiff: record a managed file in the will-be-overwritten
# list when its target copy differs from the incoming version, with a
# manifest-based classification (issue #138):
#   [LOCALLY MODIFIED]            the user edited the file since setup
#                                 last wrote it, OR the manifest exists
#                                 but never recorded this file while the
#                                 target copy differs (a user file at a
#                                 path the toolkit now ships) - the
#                                 overwrite gate below will prompt (or
#                                 require -Force)
#   [outdated]                    the file matches what setup last wrote,
#                                 the toolkit has just moved on - normal
#                                 overwrite with backup, no gate
#   [differs, provenance unknown] no manifest file at all (pre-manifest
#                                 install) - warn+backup behavior, no gate
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
  # No early return on an empty summary: Compare-Object is order-
  # insensitive, so a reorder-only edit produces no summary while the
  # bytes (and the hashes below) differ. Invoke-SafeCopy byte-compares
  # and would overwrite such a file, so it must be hashed and classified
  # here or the gate never sees it. Only a file that is clean by BOTH
  # measures is skipped.
  $curNorm = Get-ToolkitFileHash -Path $dst -IgnoreVersionStamp:$IgnoreVersionStamp
  $incNorm = Get-ToolkitFileHash -Path $Source -IgnoreVersionStamp:$IgnoreVersionStamp
  if (-not $summary -and $curNorm -eq $incNorm) { return }
  if (-not $summary) { $summary = "same lines, order or bytes differ vs incoming" }
  # Classification for the overwrite gate. The clean check (current vs
  # incoming, stamp-normalized for the two rules files) uses the same
  # normalization as the diff summary. The manifest hash was recorded
  # from the FINAL on-disk file of the previous run (after version
  # stamping), so it is compared against the plain EOL-normalized hash.
  $label = ""
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
    } elseif ($script:ManifestPresent) {
      # The manifest exists but never recorded this path, and the target
      # copy is not the incoming one: a user file sitting where the
      # toolkit now ships a managed file (or a hand-edited manifest).
      # Gate it - overwriting it silently is exactly what #138 forbids.
      # Mirrors the same rule in setup.sh's preflight_record_diff.
      $label = " [LOCALLY MODIFIED]"
      $script:PfModified += $Rel
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
# PARITY: the plan-migration line setup.sh prints (read-only mirror of the
# plan migration block below).
$pfCount = @(Get-ChildItem -Path (Join-Path $Target ".claude\plans") -Filter "PLAN-*.md" -File -ErrorAction SilentlyContinue).Count
if ($pfCount -gt 0) {
  $PfMigrations += "Plan migration (v4.0): $pfCount plan(s) move from .claude\plans\ to plans\"
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
# PARITY: the INDEX.md line setup.sh prints (read-only mirror of the legacy
# INDEX.md cleanup block below).
if (Test-Path -LiteralPath (Join-Path $Target "INDEX.md") -PathType Leaf) {
  $PfMigrations += "Legacy INDEX.md removal: backed up, then removed (replaced by CODEBASE_MAP.md)"
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
$pfAgentsDir = Join-Path $ToolkitRoot ".claude\agents"
if (Test-Path -LiteralPath $pfAgentsDir -PathType Container) {
  foreach ($src in Get-ChildItem -Path $pfAgentsDir -Filter *.md -File) {
    Add-PreflightDiff -Source $src.FullName -Rel (Join-Path ".claude\agents" $src.Name)
  }
}
foreach ($pfName in @("ask-gpt.js", "ask-gemini.js", "browse.js", "package.json", "generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js", "pre-push-check.js", "correction-ledger.js")) {
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
foreach ($pfDirName in @("agents", "commands", "rules", "scripts", "skills")) {
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

# PARITY: mirrors the `command -v node` guard on the settings.local.json
# permission merge in setup.sh. Detected once here so the pre-flight
# report can say up front that the merge will be skipped when node is
# missing, instead of the merge silently not happening further down.
$NodeAvailable = $null -ne (Get-Command node -ErrorAction SilentlyContinue)

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
# The settings.local.json permission merge skips silently inside its own
# block when node is absent. Say so here, once, so a permission that never
# arrived is not a mystery later. (setup.sh also names its package.json
# cleanup here; on this side that step is native PowerShell.)
if (-not $NodeAvailable) {
  Write-Host ""
  Write-Host "    Note: node was not found, so the .claude\settings.local.json permission"
  Write-Host "    merge will be skipped this run."
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

# Read-ToolkitText / Write-ToolkitText: byte-exact text round trip for
# the line-edited files (.gitignore). Latin-1 (code page 28591) maps
# every byte to one char and back, so editing a few lines never
# re-encodes the rest or adds a BOM - the same trick Get-ToolkitFileHash
# uses. Get-ToolkitNewline reports the newline the file already uses so
# appended or rewritten lines match it instead of mixing CRLF into an
# LF file.
function Read-ToolkitText {
  param([string]$Path)
  $enc = [System.Text.Encoding]::GetEncoding(28591)
  return $enc.GetString([System.IO.File]::ReadAllBytes($Path))
}
function Write-ToolkitText {
  param([string]$Path, [string]$Text)
  $enc = [System.Text.Encoding]::GetEncoding(28591)
  [System.IO.File]::WriteAllBytes($Path, $enc.GetBytes($Text))
}
function Get-ToolkitNewline {
  param([string]$Text)
  if ($Text.Contains("`r`n")) { return "`r`n" }
  return "`n"
}

# .gitignore is edited by two blocks below (the toolkit-line merge and
# the legacy INDEX.md cleanup). Backing it up on the first edit only
# keeps the backup a true pre-run original; a second Backup-File would
# overwrite it with the half-edited version.
$script:GitignoreBackedUp = $false

# Invoke-ToolkitNode: run a `node -e` script and capture stdout, stderr,
# and the exit code without tripping $ErrorActionPreference = "Stop".
# Windows PowerShell 5.1 turns every stderr line of a native command
# into an ErrorRecord, and under Stop the first one terminates the
# script - even with 2>$null. The preference is relaxed for the call
# only. Stdout strings and stderr records are returned separately so a
# node warning on stderr can never be mistaken for a result line.
function Invoke-ToolkitNode {
  param([string]$Script)
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $raw = @(& node -e $Script 2>&1)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  $lines = @()
  $errors = @()
  foreach ($item in $raw) {
    if ($item -is [System.Management.Automation.ErrorRecord]) {
      $errors += [string]$item.Exception.Message
    } else {
      $lines += [string]$item
    }
  }
  return @{ ExitCode = $code; Lines = $lines; Errors = $errors }
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

# --- Plan migration (v3.5 -> v4.0) -----------------------------
# PARITY: mirrors the "Plan migration (v3.5 -> v4.0)" block in setup.sh.
# Plans moved from .claude\plans\ to plans\ (top-level) because .claude\
# is a protected path that always prompts for permission. setup.ps1
# never carried this migration, so a Windows upgrade from a v3.x install
# left its plans in the old location. The upgrade notes box at the end
# reads $PlansMigrated exactly as setup.sh reads PLANS_MIGRATED.
$PlansMigrated = 0
$oldPlansDir = Join-Path $Target ".claude\plans"
$newPlansDir = Join-Path $Target "plans"
if (Test-Path -LiteralPath $oldPlansDir -PathType Container) {
  $oldPlans = @(Get-ChildItem -Path $oldPlansDir -Filter "PLAN-*.md" -File)
  if ($oldPlans.Count -gt 0) {
    New-Item -ItemType Directory -Force -Path $newPlansDir | Out-Null
    foreach ($plan in $oldPlans) {
      $newPlanPath = Join-Path $newPlansDir $plan.Name
      if (Test-Path -LiteralPath $newPlanPath -PathType Leaf) {
        Write-Host "  Skipping $($plan.Name) - already in plans\"
      } else {
        Move-Item -LiteralPath $plan.FullName -Destination $newPlanPath
        $PlansMigrated = $PlansMigrated + 1
      }
    }
  }
  # Clean up the old directory if empty (only .gitkeep or nothing left)
  $oldGitkeep = Join-Path $oldPlansDir ".gitkeep"
  if (Test-Path -LiteralPath $oldGitkeep -PathType Leaf) {
    Remove-Item -LiteralPath $oldGitkeep -Force
  }
  if (@(Get-ChildItem -Path $oldPlansDir -Force).Count -eq 0) {
    Remove-Item -LiteralPath $oldPlansDir -Force
  }
}
if ($PlansMigrated -gt 0) {
  Write-Host "  Migrated $PlansMigrated plan file(s) from .claude\plans\ to plans\"
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
# Two-phase like setup.sh: the read-only detection ran in the pre-flight
# section above ($Issue91PkgWillChange) so the report and this action
# cannot drift; here we back up and write only when it flagged the file.
# The deps are toolkit-owned and always safe to remove. The two
# convenience scripts are recognized only when their command body still
# points at the OLD `scripts/<name>.js` path so we don't clobber a script
# the user customized to do something else under the same name.
$Issue91PkgTouched = 0
$pkgPath = Join-Path $Target "package.json"
if ($Issue91PkgWillChange) {
  Backup-File -Original $pkgPath
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
    # PARITY: mirrors the failed-rewrite warning in the issue #91 block
    # of setup.sh. A migration that fails silently leaves the user with
    # a backup, an unchanged package.json, and no idea anything went
    # wrong - the worst combination. Surface it so the user can act.
    Write-Host "  Warning: could not rewrite $Target\package.json automatically."
    Write-Host "    Original is preserved in $($script:BackupDir)\package.json."
    Write-Host "    Manually remove these from your package.json dependencies:"
    Write-Host "      openai  @google/generative-ai  @google/genai  playwright-core  @axe-core/playwright"
    Write-Host "    And remove the ask-gpt / ask-gemini script entries if they still"
    Write-Host "    point at scripts/ask-gpt.js or scripts/ask-gemini.js."
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

# --- Agent definitions (upstream-owned - Invoke-SafeCopy backs up customizations) ---
# PARITY: .claude/agents/ must be copied by BOTH setup.sh and setup.ps1 (issue #152).
# Agent files carry the model/effort pins for worker subagents (the roster in
# .claude/skills/shared/model-routing.md). Guarded: an older toolkit checkout
# may not have the directory, and an absent roster just means dispatch falls
# back to inherit. Mirrors the agents block in setup.sh.
$agentsDir = Join-Path $ToolkitRoot ".claude\agents"
if (Test-Path -LiteralPath $agentsDir -PathType Container) {
  Write-Host "  Copying .claude\agents\ ..."
  $agentsDest = Join-Path $Target ".claude\agents"
  New-Item -ItemType Directory -Force -Path $agentsDest | Out-Null
  foreach ($src in Get-ChildItem -Path $agentsDir -Filter *.md -File) {
    $dest = Join-Path $agentsDest $src.Name
    try {
      Invoke-SafeCopy -Source $src.FullName -Destination $dest
    } catch {
      Write-Host "  Error: Failed to copy agents\$($src.Name): $_"
      exit 1
    }
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
Write-Host "  Copying .claude\scripts\ dep-free scripts (generate-index.js, open-artifact.sh, render-html.js, session-init.js, pre-push-check.js, correction-ledger.js) ..."
foreach ($name in @("generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js", "pre-push-check.js", "correction-ledger.js")) {
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
# PARITY: mirrors the .gitignore merge in setup.sh, including its
# trailing-newline guard: Add-Content used to glue the first appended
# entry onto a last line that lacked a newline. The lines to append are
# computed first, so .gitignore is backed up only when something will
# actually be written (and only once per run - see GitignoreBackedUp).
# Comparison is exact and case-sensitive like the grep -qxF in setup.sh,
# and each appended line joins the seen set so a duplicate in the source
# can never be appended twice.
$gitignoreSrc = Join-Path $ToolkitRoot ".gitignore"
$gitignoreDest = Join-Path $Target ".gitignore"
if (Test-Path -LiteralPath $gitignoreDest -PathType Leaf) {
  Write-Host "  Merging .gitignore (preserving your entries) ..."
  $giText = Read-ToolkitText -Path $gitignoreDest
  $giNewline = Get-ToolkitNewline -Text $giText
  $existingLines = @($giText -split "`r?`n")
  $giToAppend = @()
  foreach ($line in Get-Content -LiteralPath $gitignoreSrc) {
    # Skip blank lines and comments to avoid accumulating duplicates on repeated runs
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) { continue }
    if ($existingLines -ccontains $line -or $giToAppend -ccontains $line) { continue }
    $giToAppend += $line
  }
  if ($giToAppend.Count -gt 0) {
    if (-not $script:GitignoreBackedUp) {
      Backup-File -Original $gitignoreDest
      $script:GitignoreBackedUp = $true
    }
    # Ensure the target ends with a newline before appending
    if ($giText.Length -gt 0 -and -not $giText.EndsWith("`n")) { $giText += $giNewline }
    foreach ($line in $giToAppend) { $giText += $line + $giNewline }
    Write-ToolkitText -Path $gitignoreDest -Text $giText
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
# Same capture for settings.local.json: the permission merge below backs the
# file up before rewriting it, but only when it is the user's own copy. A
# template this run just copied carries nothing of theirs, and backing it up
# would give every fresh install a backup dir. Mirrors SETTINGS_PREEXISTED.
$SettingsPreexisted = Test-Path -LiteralPath (Join-Path $Target ".claude\settings.local.json") -PathType Leaf

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

# --- Merge new permissions into existing settings.local.json --
# PARITY: mirrors the "Merge new permissions into existing
# settings.local.json" block in setup.sh. When upgrading, the user's
# settings.local.json is preserved (not overwritten), but new toolkit
# versions may require new permissions. One node pass:
#   1. Adds any missing permissions from the toolkit's template
#   2. Removes stale entries the toolkit has retired (the relative-path
#      v4.2 script layout, the wslview grant) and stale absolute-path
#      browse.js entries left from old project locations
#   3. Injects absolute-path browse.js pipe permissions for this $Target
# The same node logic as setup.sh. node never touches the live file:
# when the merge changes anything it writes the result to a .tmp sibling
# and prints the change list; PowerShell then backs up the live file (a
# pre-existing one - see $SettingsPreexisted) and moves the .tmp into
# place. A no-op merge writes nothing, so an identical re-run makes no
# backup. A non-zero exit leaves the file untouched and prints a warning
# naming the error - stderr is kept apart from the change list, so a
# parse error can never print as a "+" permission line. Paths reach node
# through environment variables, never by interpolating them into the
# -e source (a past quoting bug).
# The script uses single quotes only: Windows PowerShell 5.1 drops
# embedded double quotes from arguments handed to native commands.
# Windows targets are C:\... paths, so the browse.js entries use forward
# slashes (the form a bash-style command line carries) and the stale-
# entry pattern accepts a drive letter as well as a leading slash.
$settingsDest = Join-Path $Target ".claude\settings.local.json"
if ((Test-Path -LiteralPath $settingsDest -PathType Leaf) -and $NodeAvailable) {
  $settingsTmp = $settingsDest + ".tmp"
  if (Test-Path -LiteralPath $settingsTmp) { Remove-Item -LiteralPath $settingsTmp -Force }
  $permsMergeJs = @'
    const fs = require('fs');
    const path = require('path');
    const toolkitSrc = process.env.TOOLKIT_SRC;
    const targetDir = process.env.TARGET_DIR;
    const tgtPath = path.join(targetDir, '.claude', 'settings.local.json');
    const src = JSON.parse(fs.readFileSync(path.join(toolkitSrc, '.claude', 'settings.local.json'), 'utf-8'));
    const tgt = JSON.parse(fs.readFileSync(tgtPath, 'utf-8'));
    if (!tgt.permissions) tgt.permissions = {};
    if (!tgt.permissions.allow) tgt.permissions.allow = [];
    const srcPerms = (src.permissions && src.permissions.allow) || [];
    let tgtPerms = tgt.permissions.allow;

    // Step 1: merge missing template permissions (the new .claude/scripts/-prefixed
    // entries land here automatically once the source template has been updated).
    const missing = srcPerms.filter(p => !tgtPerms.includes(p));

    // Step 2a: remove stale exact-match entries the toolkit has retired:
    // relative-path entries for the v4.2-and-earlier script layout (their
    // .claude/scripts/-prefixed replacements come in via Step 1's merge), and
    // the wslview grant, unused since the opener went PowerShell-first (#134).
    const STALE_PERMS = [
      'Bash(node scripts/ask-gpt.js *)',
      'Bash(node scripts/ask-gemini.js *)',
      'Bash(node scripts/browse.js *)',
      'Bash(echo * | node scripts/browse.js *)',
      'Bash(cat * | node scripts/browse.js *)',
      'Bash(wslview *)'
    ];
    const staleRel = tgtPerms.filter(p => STALE_PERMS.includes(p));

    // Step 2b: remove stale absolute-path browse.js entries. Matches both old
    // (.../scripts/browse.js) and new (.../.claude/scripts/browse.js) shapes,
    // then drops anything that doesn't equal one of the two correct entries
    // for the current target. Using exact equality (not substring .includes())
    // avoids accidentally over-keeping unusual hand-edited entries that happen
    // to contain the target prefix. A Windows target is C:\... - forward
    // slashes for the entries, and a drive-letter alternative in the pattern.
    const targetFwd = targetDir.replace(/\\/g, '/');
    const browsePattern = /^Bash\((echo|cat) \* \| node (\/|[A-Za-z]:\/).*\/(\.claude\/)?scripts\/browse\.js \*\)$/;
    const correctAbsEntries = new Set([
      'Bash(echo * | node ' + targetFwd + '/.claude/scripts/browse.js *)',
      'Bash(cat * | node ' + targetFwd + '/.claude/scripts/browse.js *)'
    ]);
    const staleAbs = tgtPerms.filter(p => browsePattern.test(p) && !correctAbsEntries.has(p));

    const stale = [...staleRel, ...staleAbs];
    tgtPerms = tgtPerms.filter(p => !stale.includes(p));

    // Step 3: add absolute-path browse.js permissions for the current target,
    // pointing at the new .claude/scripts/ location.
    const absPerms = [
      'Bash(echo * | node ' + targetFwd + '/.claude/scripts/browse.js *)',
      'Bash(cat * | node ' + targetFwd + '/.claude/scripts/browse.js *)'
    ];
    const absNew = absPerms.filter(p => !tgtPerms.includes(p));

    const allNew = [...missing, ...absNew];
    if (allNew.length > 0 || stale.length > 0) {
      tgt.permissions.allow = [...tgtPerms, ...allNew];
      // Written to the .tmp sibling; setup.ps1 backs up the live file and moves this into place.
      fs.writeFileSync(tgtPath + '.tmp', JSON.stringify(tgt, null, 2) + '\n');
      stale.forEach(p => console.log('removed: ' + p));
      allNew.forEach(p => console.log(p));
    }
'@
  $env:TOOLKIT_SRC = $ToolkitRoot
  $env:TARGET_DIR = $Target
  $permsRun = Invoke-ToolkitNode -Script $permsMergeJs
  Remove-Item -Path Env:TOOLKIT_SRC, Env:TARGET_DIR -ErrorAction SilentlyContinue
  if ($permsRun.ExitCode -ne 0) {
    if (Test-Path -LiteralPath $settingsTmp) { Remove-Item -LiteralPath $settingsTmp -Force }
    # node's first stderr line is a stack location ("[eval]:5"), not the
    # message, so take the first line that names the error; fall back to
    # the first non-empty line, then the exit code.
    $permsErrLine = @($permsRun.Errors | Where-Object { $_ -match 'Error' }) | Select-Object -First 1
    if (-not $permsErrLine) { $permsErrLine = @($permsRun.Errors | Where-Object { $_.Trim() -ne "" }) | Select-Object -First 1 }
    if (-not $permsErrLine) { $permsErrLine = "node exited $($permsRun.ExitCode)" }
    Write-Host "  Warning: could not merge permissions into .claude\settings.local.json ($permsErrLine)."
    Write-Host "    Your file was left unchanged; add new entries by hand from the permissions"
    Write-Host "    table in .claude\rules\toolkit.md."
  } elseif (Test-Path -LiteralPath $settingsTmp -PathType Leaf) {
    if ($SettingsPreexisted) {
      Backup-File -Original $settingsDest
    }
    Move-Item -LiteralPath $settingsTmp -Destination $settingsDest -Force
    Write-Host "  Updating permissions in .claude\settings.local.json ..."
    foreach ($perm in $permsRun.Lines) {
      if ($perm.StartsWith("removed: ")) {
        Write-Host "    - $($perm.Substring(9))"
      } else {
        Write-Host "    + $perm"
      }
    }
  }
}

# --- Legacy INDEX.md cleanup -----------------------------------
# PARITY: mirrors the INDEX.md removal and .gitignore cleanup in the
# "Codebase map" block of setup.sh. Prior toolkit versions wrote a
# flat-tree INDEX.md at the project root; CODEBASE_MAP.md (generated by
# /index on the first /explore) replaced it. Remove the stale file on
# upgrade so it does not sit beside the new map, backing it up first.
$indexMdPath = Join-Path $Target "INDEX.md"
if (Test-Path -LiteralPath $indexMdPath -PathType Leaf) {
  Backup-File -Original $indexMdPath
  Remove-Item -LiteralPath $indexMdPath -Force
  Write-Host "  Removed legacy INDEX.md (replaced by CODEBASE_MAP.md - generated on first /explore)"
}

# Also strip stale INDEX.md entries from the target's .gitignore. The
# merge above only adds lines, never removes retired ones, so without
# this block downstream users would keep a dangling INDEX.md entry even
# after the file itself is gone. Exact-line match like grep -qxF; the
# two lines the old toolkit .gitignore carried are dropped and every
# other line is kept as it was. .gitignore is backed up first unless the
# merge above already did.
if (Test-Path -LiteralPath $gitignoreDest -PathType Leaf) {
  $giText = Read-ToolkitText -Path $gitignoreDest
  $giLines = @($giText -split "`r?`n")
  if ($giLines -ccontains "INDEX.md") {
    if (-not $script:GitignoreBackedUp) {
      Backup-File -Original $gitignoreDest
      $script:GitignoreBackedUp = $true
    }
    $giNewline = Get-ToolkitNewline -Text $giText
    $giKept = @($giLines | Where-Object { $_ -cne "# Project index (auto-generated by toolkit)" -and $_ -cne "INDEX.md" })
    Write-ToolkitText -Path $gitignoreDest -Text ($giKept -join $giNewline)
    Write-Host "    Cleaned stale INDEX.md entries from .gitignore"
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
# PARITY: mirrors the atomic manifest write in setup.sh. The previous
# manifest is backed up first when the new body differs (an identical
# re-run backs up nothing, so it still creates no backup dir), then the
# body is written to a .tmp sibling and moved into place, so a run that
# dies mid-write leaves the old manifest intact rather than a truncated
# one that would read as "no entries" on the next run.
$manifestUtf8NoBom = New-Object System.Text.UTF8Encoding($false)
if (Test-Path -LiteralPath $script:ManifestPath -PathType Leaf) {
  $prevManifest = [System.IO.File]::ReadAllText($script:ManifestPath)
  if ($prevManifest -cne $manifestBody) {
    Backup-File -Original $script:ManifestPath
  }
}
$manifestTmp = $script:ManifestPath + ".tmp"
[System.IO.File]::WriteAllText($manifestTmp, $manifestBody, $manifestUtf8NoBom)
Move-Item -LiteralPath $manifestTmp -Destination $script:ManifestPath -Force
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
  Write-Host "    Setup preserves any file it would overwrite or delete. If you"
  Write-Host "    customized a toolkit file, your original is safe in the directory"
  Write-Host "    above. Delete it when you are done."
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

# --- Upgrade notes (shown if legacy cleanup or plan migration happened) ---
# PARITY: mirrors the "Upgrade notes" box in setup.sh, which setup.ps1
# could not carry while it lacked the plan migration. Fires when the
# v3.5 legacy-command cleanup or the v4.0 plan migration ran this run.
if ($LegacyCleaned -gt 0 -or $PlansMigrated -gt 0) {
  Write-Host "    +------------------------------------------------+"
  Write-Host "    |  Upgraded to v$Version - here's what changed:     |"
  Write-Host "    +------------------------------------------------+"
  Write-Host ""
  if ($LegacyCleaned -gt 0) {
    Write-Host "      - Review commands are now skills (.claude\skills\)"
    Write-Host "        They still work as /review-code, /review-ux, etc."
    Write-Host ""
    Write-Host "      - NEW: /review - auto-detects changes, dispatches"
    Write-Host "        the right review skills, combines findings"
    Write-Host ""
    Write-Host "      - NEW: /review-deps - dependency security review"
    Write-Host "      - NEW: /codebase-to-course - learn any codebase"
    Write-Host ""
    Write-Host "      - browse.js now supports accessibility scanning"
    Write-Host "        and responsive screenshots. The dep ships with"
    Write-Host "        the toolkit's quarantined .claude\scripts\."
    Write-Host ""
  }
  if ($PlansMigrated -gt 0) {
    Write-Host "      - Plans moved from .claude\plans\ to plans\"
    Write-Host "        No more permission prompts for plan files."
    Write-Host "        Your existing plans were moved automatically."
    Write-Host ""
  }
  # PARITY: same pointer lines as setup.sh's legacy box (holistic pass, S1):
  # a pre-manifest upgrader is the reader who most needs "what changed since".
  Write-Host "      Everything since then, in the toolkit repo:"
  Write-Host ""
  Write-Host "      - CHANGELOG.md: the `"What's new since`" rollup at the top,"
  Write-Host "        then the newest version section right below it."
  Write-Host "      - AGENT-SETUP.md: the `"What's new in v$Version`" block."
  Write-Host ""
}

# --- New-this-version announcement (upgrades only) -----------
# Fires on any upgrade the upgrade notes box above did not cover, so a
# plain version bump never lands silently. Version-neutral on purpose:
# the old text described one release (the v5.0 HTML viewing feature)
# and went stale on the next bump, so a v5.5 -> v6.0 upgrade read about
# HTML instead of auto-by-default. CHANGELOG.md and AGENT-SETUP.md are
# kept current by bump-version.sh, so this box only points at them;
# neither file is copied into the target, hence "in the toolkit repo".
# Mirrors the Bash block in setup.sh, gate included, now that the
# $LegacyCleaned and $PlansMigrated counters exist on this side too.
if ($IsUpgrade -and $LegacyCleaned -eq 0 -and $PlansMigrated -eq 0) {
  Write-Host "    +------------------------------------------------+"
  Write-Host "    |  Upgraded to v$Version - new this version:        |"
  Write-Host "    +------------------------------------------------+"
  Write-Host ""
  Write-Host "      Upgrade complete. To see what changed, open in the toolkit repo:"
  Write-Host ""
  Write-Host "      - CHANGELOG.md: the `"What's new since`" rollup at the top,"
  Write-Host "        then the newest version section right below it."
  Write-Host "      - AGENT-SETUP.md: the `"What's new in v$Version`" block."
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
