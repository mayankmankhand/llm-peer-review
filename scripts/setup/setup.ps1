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

# Check runtime scripts (must exist)
foreach ($f in @("ask-gpt.js", "ask-gemini.js", "browse.js")) {
  $p = Join-Path $ToolkitRoot (Join-Path "scripts" $f)
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

foreach ($f in @("VERSION", "CLAUDE.md", "LESSONS.md", ".env.local.example", ".claude\settings.local.json", ".claude\rules\toolkit.md", ".gitignore", ".gitattributes")) {
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

New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\rules") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target "scripts") | Out-Null

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

# --- Scripts (runtime scripts only - setup scripts stay in toolkit repo) ---
Write-Host "  Copying scripts\ ..."
foreach ($scriptName in @("ask-gpt.js", "ask-gemini.js", "browse.js")) {
  try {
    $src = Join-Path $ToolkitRoot (Join-Path "scripts" $scriptName)
    $dest = Join-Path $Target (Join-Path "scripts" $scriptName)
    Invoke-SafeCopy -Source $src -Destination $dest
  } catch {
    Write-Host "  Error: Failed to copy $scriptName : $_"
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

Write-Host "    What to do next:"
Write-Host ""
Write-Host "      cd $Target"
Write-Host ""
Write-Host "      1. Install the npm packages:"
Write-Host "           npm install @google/generative-ai openai"
Write-Host ""
Write-Host "      2. Set up your API keys:"
Write-Host "           Copy-Item .env.local.example .env.local"
Write-Host "         Then open .env.local and paste:"
Write-Host "           OPENAI_API_KEY  ->  https://platform.openai.com/api-keys"
Write-Host "           GEMINI_API_KEY  ->  https://aistudio.google.com/apikey"
Write-Host ""
Write-Host "      4. Open the folder in Cursor and run /explore to start your first workflow."
Write-Host ""
Write-Host "      3. (Optional) Install browser QA for /review-browser:"
Write-Host "           npm install playwright-core"
Write-Host "           npx playwright-core install chromium"
Write-Host ""
Write-Host "      Steps 1-3 are optional. Skip 1-2 if you don't need"
Write-Host "      /ask-gpt or /ask-gemini. Skip 3 if you don't need"
Write-Host "      /review-browser."
Write-Host ""
Write-Host "    Tip: To update commands and scripts, run setup again from"
Write-Host "    the toolkit repo: powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Target `"$Target`""
Write-Host ""
