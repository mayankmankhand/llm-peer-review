# setup.ps1 - Copy the LLM Peer Review toolkit into any project (Windows PowerShell).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup\setup.ps1 -Target "C:\path\to\your-project"
#
# If -Target is omitted, uses the current working directory (but will error if run from inside the toolkit repo).
#
# Examples:
#   # From toolkit repo, specify target:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup\setup.ps1 -Target "C:\Projects\my-app"
#
#   # From your project directory:
#   cd C:\Projects\my-app
#   powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup\setup.ps1

param(
  [string]$Target = "."
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
$ToolkitRoot = Resolve-Path (Join-Path $ScriptDir "..\..")

# If no target specified, prompt for it
if ($Target -eq ".") {
  $currentDir = (Get-Location).Path
  $resolvedCurrent = (Resolve-Path -LiteralPath $currentDir).Path
  $resolvedToolkit = (Resolve-Path -LiteralPath $ToolkitRoot).Path
  
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
  $Target = (Resolve-Path -LiteralPath $Target).Path
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

foreach ($f in @("VERSION", "CLAUDE.md", "LESSONS.md", ".env.local.example", ".claude\settings.local.json", ".claude\rules\toolkit.md", ".claude\rules\html-outputs.md", "artifacts\README.md", ".gitignore", ".gitattributes")) {
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

New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\rules") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\scripts") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\skills") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target "artifacts") | Out-Null

# --- Backup helpers (issue #79) --------------------------------
# Before overwriting or deleting any file in the target, copy the original
# to a timestamped backup directory at the target root. The directory is
# only created on the first backup (no noise for clean installs). All
# backups in one setup run share the same timestamp.
$script:BackupDir = ""
$script:BackupCount = 0

# Backup-File: copy a target-resident file into the backup root, mirroring
# its relative path. Creates the backup root lazily on first call. Appends
# $PID to the timestamp so two same-second runs get distinct backup dirs
# (avoids silent overwrite of a prior run's backups).
function Backup-File {
  param([string]$Original)
  if ([string]::IsNullOrEmpty($script:BackupDir)) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $script:BackupDir = Join-Path $Target ".toolkit-backup-$stamp-$PID"
  }
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

# --- Renamed files cleanup (issue #80) ----------------------
# When a toolkit file is renamed upstream (e.g. dev-lead-gpt.md -> ask-gpt.md),
# copying the new name is not enough: the old file sticks around and still
# loads as a stale slash command. Each entry maps an old relative path to the
# new one. Backup-File preserves any customizations the user made to the
# old-named file before Remove-Item removes it.
$RenamedFiles = @(
  @{ Old = ".claude\commands\dev-lead-gpt.md";    New = ".claude\commands\ask-gpt.md" },
  @{ Old = ".claude\commands\dev-lead-gemini.md"; New = ".claude\commands\ask-gemini.md" },
  @{ Old = "scripts\dev-lead-gpt.js";             New = ".claude\scripts\ask-gpt.js" },
  @{ Old = "scripts\dev-lead-gemini.js";          New = ".claude\scripts\ask-gemini.js" }
)
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
# get identical behavior.
$Issue91OldScripts = @("scripts\ask-gpt.js", "scripts\ask-gemini.js", "scripts\browse.js")
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
    $TOOLKIT_DEPS = @("openai", "@google/generative-ai", "playwright-core", "@axe-core/playwright")
    $TOOLKIT_SCRIPTS = @("ask-gpt", "ask-gemini")
    $touched = $false
    if ($pkg.PSObject.Properties.Name -contains "dependencies" -and $pkg.dependencies) {
      foreach ($dep in $TOOLKIT_DEPS) {
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
      foreach ($s in $TOOLKIT_SCRIPTS) {
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

Write-Host "  Copying .env.local.example ..."
try {
  Copy-Item -LiteralPath (Join-Path $ToolkitRoot ".env.local.example") -Destination (Join-Path $Target ".env.local.example") -Force
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
