# setup.ps1 - Copy the LLM Peer Review toolkit into any project (Windows PowerShell).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup\setup.ps1 -Target "C:\path\to\your-project" [-DryRun] [-Force] [-Tools <list>]
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
# -Tools <list> names the AI tools this project generates layouts for
# beyond Claude Code (issue #144): a comma-separated list drawn from codex,
# cursor, antigravity, or `none` for Claude Code only. It works on any run,
# fresh or upgrade, and re-records the answer in .claude\.toolkit-tools.json;
# a tool dropped from the list has its generated files cleaned. Without the
# flag, a fresh install on an interactive host asks once; every other run
# reuses the recorded answer (default: Claude Code only) and never asks.
#
# Examples:
#   # From toolkit repo, specify target:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup\setup.ps1 -Target "C:\Projects\my-app"
#
#   # See what an upgrade would do without changing anything:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup\setup.ps1 -Target "C:\Projects\my-app" -DryRun
#
#   # Generate the Codex and Cursor layouts beside the Claude Code one:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup\setup.ps1 -Target "C:\Projects\my-app" -Tools codex,cursor
#
#   # From your project directory:
#   cd C:\Projects\my-app
#   powershell -ExecutionPolicy Bypass -File C:\path\to\llm-peer-review\scripts\setup\setup.ps1

# PARITY: mirrors setup.sh (--tools argument) - change both together
# -Tools is [string[]] so both spellings bind the same way: a bare
# `-Tools codex,cursor` reaches a string parameter as "codex cursor" (the
# comma makes an array PowerShell joins with a space), while a quoted
# "codex,cursor" arrives whole. The value is rejoined, re-split, and
# validated in the "Tool layouts" block below, after the target is known.
param(
  [string]$Target = ".",
  [switch]$DryRun,
  [switch]$Force,
  [string[]]$Tools
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

# Check dep-free runtime scripts (index generator + artifact opener + HTML renderer + session-init + pre-push tripwire + correction ledger + gen-media) - must exist.
foreach ($f in @("generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js", "pre-push-check.js", "correction-ledger.js", "gen-media.js")) {
  $p = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $f)
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Error: source file not found: $p"
    $PreflightOk = $false
  }
}

# Check the layout build, write-guard, and chain-hook scripts (dependency-free;
# issue #144), plus the per-tool emitters and host notes build-layouts.js reads.
# PARITY: mirrors setup.sh (issue #144 source checks) - change both together
# The two directories must each hold at least one file: an empty one would copy
# nothing, and the build would then emit only the shared files for every tool.
foreach ($f in @("build-layouts.js", "write-guard.js", "chain-hook.js")) {
  $p = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $f)
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Error: source file not found: $p"
    $PreflightOk = $false
  }
}
$LayoutsSrcDir = Join-Path $ToolkitRoot ".claude\scripts\layouts"
if (@(Get-ChildItem -Path $LayoutsSrcDir -Filter *.js -File -ErrorAction SilentlyContinue).Count -eq 0) {
  Write-Host "  Error: no emitter files found in $LayoutsSrcDir\"
  $PreflightOk = $false
}
$HostNotesSrcDir = Join-Path $ToolkitRoot ".claude\skills\shared\host-notes"
if (@(Get-ChildItem -Path $HostNotesSrcDir -Filter *.md -File -ErrorAction SilentlyContinue).Count -eq 0) {
  Write-Host "  Error: no host-notes files found in $HostNotesSrcDir\"
  $PreflightOk = $false
}

# Check files that will be copied to the target project. Since issue #144 the
# toolkit repo no longer tracks .claude\settings.local.json: the permission seed
# is .claude\toolkit-permissions.json, translated per machine by build-layouts.js.
foreach ($f in @("VERSION", "CLAUDE.md", "LESSONS.md", "LESSONS-detail.md", ".env.local.example", ".claude\toolkit-permissions.json", ".claude\rules\toolkit.md", ".claude\rules\html-outputs.md", "artifacts\README.md", ".gitignore", ".gitattributes", ".claude\skills\shared\design-profile-template.md")) {
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

# --- Shared helpers used on both sides of the -DryRun exit -----
# Defined up here, before the pre-flight, because the issue #144 blocks
# below (the tools answer and the pre-push hook plan) read files during the
# read-only pre-flight; until then only the copy phase needed them.

# Read-ToolkitText / Write-ToolkitText: byte-exact text round trip for
# the line-edited files (.gitignore) and the small files setup writes
# itself (the tools record, the pre-push hook). Latin-1 (code page 28591)
# maps every byte to one char and back, so editing a few lines never
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

# Test-ToolkitCanPrompt: whether a human can answer a Read-Host here - the
# PowerShell side of bash's `[ -t 0 ]`. Redirected stdin or a
# non-interactive host must take the no-prompt path (abort, or the default
# answer), never block forever. Shared by the overwrite gate, the tools
# question, and the Codex trust offer.
function Test-ToolkitCanPrompt {
  try {
    if ([Console]::IsInputRedirected) { return $false }
  } catch {
    return $false
  }
  if (-not [Environment]::UserInteractive) { return $false }
  return $true
}

# Invoke-ToolkitGit: run git against a directory and capture stdout and
# the exit code without tripping $ErrorActionPreference = "Stop". Same
# stderr rule as Invoke-ToolkitNode below: Windows PowerShell 5.1 turns
# every stderr line of a native command into an ErrorRecord, and under
# Stop the first one ("fatal: not a git repository") would terminate the
# script, so the preference is relaxed for the call only. Stderr records
# are dropped; callers read the exit code and the stdout lines.
function Invoke-ToolkitGit {
  param([string]$Repo, [string[]]$GitArgs)
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $raw = @(& git -C $Repo @GitArgs 2>&1)
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $prevEap
  }
  $lines = @()
  foreach ($item in $raw) {
    if ($item -isnot [System.Management.Automation.ErrorRecord]) { $lines += [string]$item }
  }
  return @{ ExitCode = $code; Lines = $lines }
}
$GitAvailable = $null -ne (Get-Command git -ErrorAction SilentlyContinue)

# The per-machine files (issue #144) live under the user profile. Read from
# $env:USERPROFILE (falling back to $HOME) rather than $HOME alone, so a
# test can redirect every per-machine read and write with one environment
# variable, the way the bash suite redirects $HOME. Resolved once here so
# the pre-flight report and the merges after the copies name the same files.
$UserHome = $env:USERPROFILE
if (-not $UserHome) { $UserHome = $HOME }
$CursorDst = Join-Path $UserHome ".cursor\permissions.json"
$AgDst = Join-Path $UserHome ".gemini\antigravity-cli\settings.json"
$CodexCfg = Join-Path $UserHome ".codex\config.toml"

# --- Tool layouts: the recorded answer (issue #144) ------------
# PARITY: mirrors setup.sh (tools answer) - change both together
# Which AI tools this project generates layouts for, beyond Claude Code.
# The answer lives in .claude\.toolkit-tools.json in the target (committed
# there, so it is the repo's choice and reaches every collaborator). It is
# resolved here, before the pre-flight report, so the report can say what
# will be built; nothing is written until the copy phase. Precedence:
#   1. -Tools <list>              any run, fresh or upgrade; re-records it
#   2. the recorded file          reused as-is, never asked again
#   3. fresh install + console    asked once (default: Claude Code only).
#                                 A -DryRun never asks: it reports the
#                                 default and says the real run will ask
#   4. otherwise                  Claude Code only
# Everything here is READ-ONLY. The file is parsed with a regex rather
# than ConvertFrom-Json, the way setup.sh uses sed: setup writes it in a
# fixed one-line shape, and this repo's own committed copy keeps the key
# and its list on one line too.
$ToolsKnown = @("codex", "cursor", "antigravity")
$ToolsFileRel = ".claude\.toolkit-tools.json"
$ToolsFile = Join-Path $Target $ToolsFileRel
$script:ToolsChosen = @()
# Test-ToolsHas <name>: true when <name> is in this run's answer.
function Test-ToolsHas {
  param([string]$Name)
  return ($script:ToolsChosen -ccontains $Name)
}
# Add-ToolsEntry <name>: append <name> to the answer unless it is already there.
function Add-ToolsEntry {
  param([string]$Name)
  if (-not ($script:ToolsChosen -ccontains $Name)) { $script:ToolsChosen += $Name }
}
# Get-ToolsList: the answer as prose, for the report lines.
function Get-ToolsList {
  if ($script:ToolsChosen.Count -eq 0) { return "none (Claude Code only)" }
  return ($script:ToolsChosen -join ", ")
}
# Get-ToolsJsonList: the answer as the JSON array body the record is written with.
function Get-ToolsJsonList {
  return (@($script:ToolsChosen | ForEach-Object { '"' + $_ + '"' }) -join ", ")
}
$ToolsPrev = @()
$ToolsFilePreexisted = $false
if (Test-Path -LiteralPath $ToolsFile -PathType Leaf) {
  $ToolsFilePreexisted = $true
  $toolsRaw = (Read-ToolkitText -Path $ToolsFile) -replace "[`r`n]", ""
  $toolsMatch = [regex]::Match($toolsRaw, '"tools"\s*:\s*\[([^\]]*)\]')
  if ($toolsMatch.Success) {
    foreach ($toolsName in @($toolsMatch.Groups[1].Value -split ",")) {
      $toolsName = $toolsName -replace '[\s"]', ''
      if (-not $toolsName) { continue }
      if ($ToolsKnown -ccontains $toolsName) {
        $ToolsPrev += $toolsName
      } else {
        Write-Host "  Warning: ignoring unknown tool `"$toolsName`" in $ToolsFileRel"
      }
    }
  }
}
$ToolsSource = ""
if ($PSBoundParameters.ContainsKey("Tools")) {
  $toolsArg = @(((@($Tools) -join ",") -split "[,\s]+") | Where-Object { $_ -ne "" })
  if ($toolsArg.Count -eq 0) {
    Write-Host ""
    Write-Host "  Error: -Tools needs a value: codex, cursor, antigravity (comma-separated), or none"
    Write-Host ""
    exit 1
  }
  if (-not ($toolsArg.Count -eq 1 -and $toolsArg[0] -ceq "none")) {
    foreach ($toolsName in $toolsArg) {
      if ($ToolsKnown -ccontains $toolsName) {
        Add-ToolsEntry -Name $toolsName
      } else {
        Write-Host ""
        Write-Host "  Error: unknown tool in -Tools: $toolsName"
        Write-Host "  Known tools: codex, cursor, antigravity (comma-separated), or none for Claude Code only"
        Write-Host ""
        exit 1
      }
    }
  }
  $ToolsSource = "from -Tools"
} elseif ($ToolsFilePreexisted) {
  foreach ($toolsName in $ToolsPrev) { Add-ToolsEntry -Name $toolsName }
  $ToolsSource = "recorded in $ToolsFileRel"
} elseif (-not $IsUpgrade -and -not $DryRun -and (Test-ToolkitCanPrompt)) {
  Write-Host "  Which AI tools should this project generate layouts for, besides Claude Code?"
  Write-Host "  Every chosen layout lives side by side, so switching tools later needs nothing;"
  Write-Host "  add or remove one any time with: setup.ps1 -Target <target> -Tools <list>"
  Write-Host ""
  Write-Host "    1) Codex CLI        .agents\, .codex\, AGENTS.md"
  Write-Host "    2) Cursor           .agents\, .cursor\, AGENTS.md"
  Write-Host "    3) Antigravity CLI  .agents\, AGENTS.md"
  Write-Host ""
  $toolsReply = ""
  try {
    $toolsReply = Read-Host "  Numbers separated by commas (e.g. 1,2), or Enter for Claude Code only"
  } catch {
    $toolsReply = ""
  }
  Write-Host ""
  foreach ($toolsName in @(([string]$toolsReply) -split ",")) {
    $toolsName = $toolsName -replace '\s', ''
    if (-not $toolsName) { continue }
    if ($toolsName -eq "1" -or $toolsName -ceq "codex") {
      Add-ToolsEntry -Name "codex"
    } elseif ($toolsName -eq "2" -or $toolsName -ceq "cursor") {
      Add-ToolsEntry -Name "cursor"
    } elseif ($toolsName -eq "3" -or $toolsName -ceq "antigravity") {
      Add-ToolsEntry -Name "antigravity"
    } else {
      Write-Host "  Error: unrecognized answer: $toolsName (expected numbers 1-3, or Enter for none)."
      Write-Host "  Nothing was changed. Re-run, or pass the list directly: setup.ps1 -Target `"$Target`" -Tools codex,cursor"
      Write-Host ""
      exit 1
    }
  }
  $ToolsSource = "asked above"
} elseif (-not $IsUpgrade -and $DryRun -and (Test-ToolkitCanPrompt)) {
  $ToolsSource = "default for this dry run; the real run asks once, or pass -Tools"
} else {
  $ToolsSource = "default: Claude Code only"
}
# Tools the recorded answer had that this run drops: their generated files
# are removed with build-layouts.js --clean after the copy phase.
$ToolsDropped = @()
foreach ($toolsName in $ToolsPrev) {
  if (-not (Test-ToolsHas -Name $toolsName)) { $ToolsDropped += $toolsName }
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
foreach ($pfName in @("ask-gpt.js", "ask-gemini.js", "browse.js", "package.json", "generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js", "pre-push-check.js", "correction-ledger.js", "gen-media.js", "build-layouts.js", "write-guard.js", "chain-hook.js")) {
  Add-PreflightDiff -Source (Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $pfName)) -Rel (Join-Path ".claude\scripts" $pfName)
}
# Issue #144: the per-tool emitters, the host notes, and the permission list.
# Two new directories (the shared\*.md loop above is top-level only). The
# files build-layouts.js WRITES (.agents\, .codex\, .cursor\, AGENTS.md,
# .claude\.toolkit-generated.json) and the tools answer
# (.claude\.toolkit-tools.json) are deliberately not here: they never enter
# ManagedRels or the manifest. The build hashes its own output, and the
# answer is the repo's, not the toolkit's. Mirrors setup.sh.
foreach ($src in Get-ChildItem -Path $LayoutsSrcDir -Filter *.js -File -ErrorAction SilentlyContinue) {
  Add-PreflightDiff -Source $src.FullName -Rel (Join-Path ".claude\scripts\layouts" $src.Name)
}
foreach ($src in Get-ChildItem -Path $HostNotesSrcDir -Filter *.md -File -ErrorAction SilentlyContinue) {
  Add-PreflightDiff -Source $src.FullName -Rel (Join-Path ".claude\skills\shared\host-notes" $src.Name)
}
Add-PreflightDiff -Source (Join-Path $ToolkitRoot ".claude\toolkit-permissions.json") -Rel ".claude\toolkit-permissions.json"
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

# Issue #144: a bare `.cursor/` ignore line. The toolkit's .gitignore matches
# the directory as .cursor/* and re-includes the generated Cursor files by
# name; git never descends into an excluded directory, so the old bare line
# (every install before v7) would keep every negation dead. Detected here
# (read-only) for the report; removed after the .gitignore merge below.
$PfCursorBare = $false
$pfGitignore = Join-Path $Target ".gitignore"
if (Test-Path -LiteralPath $pfGitignore -PathType Leaf) {
  if (@((Read-ToolkitText -Path $pfGitignore) -split "`r?`n") -ccontains ".cursor/") { $PfCursorBare = $true }
}

# --- Git pre-push hook plan (issue #144) -----------------------
# PARITY: mirrors setup.sh (pre-push hook plan) - change both together
# Read-only: decides what the hook block after the copies will do, so the
# report can say it and -DryRun can stop here. The hook runs the M11
# tripwire (secret scan, never-push files, settings diff, and the generated-
# layout check) on every push. Git runs hooks from the repository root, so
# the script path inside the hook is relative. The hooks directory comes
# from `git rev-parse --git-path hooks`, which resolves a worktree to the
# main checkout's hooks; a relative answer is relative to the target. A
# target that sits inside a repository rooted elsewhere is skipped: the
# relative path would not resolve from that root and every push would fail.
# A pre-push hook without the marker line is somebody else's and is never
# replaced; one with the marker is refreshed only when its content differs.
$HookMarker = "# llm-peer-review toolkit pre-push hook (issue #144)"
# Get-HookContent: the hook text, LF-joined with a trailing LF - the exact
# bytes setup.sh's printf writes. Git runs the hook through sh on Windows
# too, and sh needs LF.
function Get-HookContent {
  return ((@(
    '#!/bin/sh',
    $HookMarker,
    '# Runs the M11 tripwire (secret scan, never-push files, settings diff, and the',
    '# generated-layout check) before every push. Git runs hooks from the repository',
    '# root, so the relative path below resolves there. Installed by the toolkit',
    '# setup; safe to delete, and re-created by the next setup run.',
    'exec node .claude/scripts/pre-push-check.js'
  ) -join "`n") + "`n")
}
# ConvertTo-ToolkitComparablePath: git prints forward slashes (C:/x, or
# //server/share/x for a UNC target) while the target is a native path.
# Both are flipped to backslashes and stripped of a trailing separator, and
# the caller compares case-insensitively, as the Windows filesystem does.
function ConvertTo-ToolkitComparablePath {
  param([string]$Path)
  return (([string]$Path).Replace('/', '\')).TrimEnd('\')
}
$HookState = "not-git"
$HookDir = ""
$HookFile = ""
if ($GitAvailable -and (Invoke-ToolkitGit -Repo $Target -GitArgs @("rev-parse", "--git-dir")).ExitCode -eq 0) {
  $hookTop = Invoke-ToolkitGit -Repo $Target -GitArgs @("rev-parse", "--show-toplevel")
  $hookTopLevel = ""
  if ($hookTop.ExitCode -eq 0 -and @($hookTop.Lines).Count -gt 0) { $hookTopLevel = ([string]@($hookTop.Lines)[0]).Trim() }
  $hookCfg = Invoke-ToolkitGit -Repo $Target -GitArgs @("config", "--get", "core.hooksPath")
  $hookHooksPath = ""
  if ($hookCfg.ExitCode -eq 0 -and @($hookCfg.Lines).Count -gt 0) { $hookHooksPath = ([string]@($hookCfg.Lines)[0]).Trim() }
  if ((ConvertTo-ToolkitComparablePath -Path $hookTopLevel) -ine (ConvertTo-ToolkitComparablePath -Path $Target)) {
    $HookState = "other-root"
  } elseif ($hookHooksPath -ne "") {
    $HookState = "hooks-path"
  } else {
    # --git-path needs git 2.5 (2015); an older git fails here and the
    # empty answer becomes the old-git state.
    $hookPathRun = Invoke-ToolkitGit -Repo $Target -GitArgs @("rev-parse", "--git-path", "hooks")
    if ($hookPathRun.ExitCode -eq 0 -and @($hookPathRun.Lines).Count -gt 0) { $HookDir = ([string]@($hookPathRun.Lines)[0]).Trim() }
    if ($HookDir -ne "") {
      $HookDir = $HookDir.Replace('/', '\')
      if (-not [System.IO.Path]::IsPathRooted($HookDir)) { $HookDir = Join-Path $Target $HookDir }
      $HookFile = Join-Path $HookDir "pre-push"
    }
    if ($HookDir -eq "") {
      $HookState = "old-git"
    } elseif (-not (Test-Path -LiteralPath $HookFile)) {
      $HookState = "install"
    } elseif (-not (Test-Path -LiteralPath $HookFile -PathType Leaf)) {
      $HookState = "foreign"
    } else {
      $hookExisting = Read-ToolkitText -Path $HookFile
      if (-not $hookExisting.Contains($HookMarker)) {
        $HookState = "foreign"
      } elseif ($hookExisting.Replace("`r", "") -ceq (Get-HookContent)) {
        $HookState = "identical"
      } else {
        $HookState = "replace"
      }
    }
  }
}

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
# PARITY: mirrors setup.sh (tool layouts pre-flight section) - change both together
# Issue #144: the tools answer, what the copy phase will build or clean for
# it, the per-machine steps that follow, the pre-push hook plan, and the
# .gitignore repair. Each line mirrors a block after the -DryRun exit.
Write-Host ""
Write-Host "    Tool layouts (issue #144):"
Write-Host "      Tools: $(Get-ToolsList) ($ToolsSource)"
if ($ToolsDropped.Count -gt 0) {
  Write-Host "      - Remove the generated files of: $($ToolsDropped -join ' ') (build-layouts.js --clean)"
}
if ($script:ToolsChosen.Count -gt 0) {
  Write-Host "      - Build the layouts from .claude\ (node .claude\scripts\build-layouts.js)"
  if (Test-ToolsHas -Name "cursor") {
    Write-Host "      - Cursor: merge the terminal allowlist into $CursorDst"
    Write-Host "        (machine-global: every Cursor project on this machine runs in Allowlist mode)"
  }
  if (Test-ToolsHas -Name "antigravity") {
    Write-Host "      - Antigravity: merge the permissions into $AgDst (machine-global)"
  }
  if (Test-ToolsHas -Name "codex") {
    Write-Host "      - Codex: offer to trust this project in $CodexCfg, plus a one-time /hooks step"
  }
}
if ($PfCursorBare) {
  Write-Host "      - .gitignore: remove the bare .cursor/ line (it keeps the generated Cursor files ignored)"
}
if ($HookState -eq "install") {
  Write-Host "      Git pre-push hook: install $HookFile (runs the M11 tripwire)"
} elseif ($HookState -eq "replace") {
  Write-Host "      Git pre-push hook: refresh $HookFile (toolkit hook, content differs; backed up first)"
} elseif ($HookState -eq "identical") {
  Write-Host "      Git pre-push hook: already installed at $HookFile"
} elseif ($HookState -eq "foreign") {
  Write-Host "      Git pre-push hook: $HookFile exists and is not the toolkit's - left alone"
} elseif ($HookState -eq "hooks-path") {
  Write-Host "      Git pre-push hook: skipped, core.hooksPath is set for this repository"
} elseif ($HookState -eq "other-root") {
  Write-Host "      Git pre-push hook: skipped, the target is inside a repository rooted elsewhere"
} elseif ($HookState -eq "old-git") {
  Write-Host "      Git pre-push hook: skipped, this git cannot report its hooks directory (needs git 2.5+)"
} else {
  Write-Host "      Git pre-push hook: skipped, the target is not a git repository"
}
# PARITY: mirrors setup.sh (node-absent pre-flight note) - change both together
# The node-dependent steps (the settings.local.json seed and permission
# merge, and the issue #144 layout build and clean) skip inside their own
# blocks when node is absent. Say so here, once, so a permission or a
# layout that never arrived is not a mystery later. (setup.sh also names
# its package.json cleanup here; on this side that step is native
# PowerShell.)
if (-not $NodeAvailable) {
  Write-Host ""
  Write-Host "    Note: node was not found, so the .claude\settings.local.json permission"
  Write-Host "    merge will be skipped this run."
  if ($script:ToolsChosen.Count -gt 0 -or $ToolsDropped.Count -gt 0) {
    Write-Host "    The tool layouts will not be built or cleaned either. Once node is installed,"
    Write-Host "    run from the project root: node .claude\scripts\build-layouts.js"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $Target ".claude\settings.local.json") -PathType Leaf)) {
    Write-Host "    .claude\settings.local.json will not be seeded. Once node is installed, run"
    Write-Host "    from the project root: node .claude\scripts\build-layouts.js --claude-settings"
  }
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
  # non-interactive host must take the abort path, not block forever
  # (Test-ToolkitCanPrompt, shared with the issue #144 prompts).
  $canPrompt = Test-ToolkitCanPrompt
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
  } else {
    # A file outside the target keeps its absolute path here (issue #144:
    # the per-machine files under the user profile, or a worktree's hooks
    # under the main checkout). Dropping the root marker - the colon of a
    # drive letter, the leading slashes of a UNC path - mirrors it under
    # the backup root like any other file (C:\Users\me\.cursor\permissions.json
    # lands at <backup>\C\Users\me\.cursor\permissions.json), the way
    # setup.sh drops the leading slash instead of producing a double one.
    $rel = ($rel -replace '^([A-Za-z]):\\', '$1\').TrimStart('\')
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

# Read-ToolkitText, Write-ToolkitText, and Get-ToolkitNewline (the
# byte-exact text round trip the line-edited files use) live in the
# "Shared helpers" section above the pre-flight: since issue #144 the
# read-only pre-flight needs them too.

# .gitignore is edited by three blocks below (the toolkit-line merge, the
# bare .cursor/ line removal, and the legacy INDEX.md cleanup). Backing it
# up on the first edit only keeps the backup a true pre-run original; a
# second Backup-File would overwrite it with the half-edited version.
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

# Invoke-ToolkitNodeFile: the same capture for `node <script> <args>` - the
# build-layouts.js runs (issue #144). Paths travel as separate arguments
# here, never interpolated into a -e source string.
function Invoke-ToolkitNodeFile {
  param([string]$File, [string[]]$NodeArgs)
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $raw = @(& node $File @NodeArgs 2>&1)
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

# Get-ToolkitFirstLine: the first non-blank line of a node run's output,
# stdout first, for the one-line warnings (bash: grep -v blank | head -1).
function Get-ToolkitFirstLine {
  param($Run)
  foreach ($l in @(@($Run.Lines) + @($Run.Errors))) {
    if (([string]$l).Trim() -ne "") { return ([string]$l).Trim() }
  }
  return "node exited $($Run.ExitCode)"
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

# PARITY: shared\host-notes\ must be copied by BOTH setup.sh and setup.ps1 (issue #144).
# Same shape as the shells\ block above: the shared\*.md loop is top-level only
# and the per-skill loop below skips shared\, so the per-tool host notes (the
# "Host notes" section build-layouts.js appends to every generated skill) need
# their own copy step. Mirrors the host-notes block in setup.sh.
if (Test-Path -LiteralPath $HostNotesSrcDir -PathType Container) {
  $hostNotesDest = Join-Path $Target ".claude\skills\shared\host-notes"
  New-Item -ItemType Directory -Force -Path $hostNotesDest | Out-Null
  foreach ($src in Get-ChildItem -Path $HostNotesSrcDir -Filter *.md -File) {
    $dest = Join-Path $hostNotesDest $src.Name
    try {
      Invoke-SafeCopy -Source $src.FullName -Destination $dest
    } catch {
      Write-Host "  Error: Failed to copy shared\host-notes\$($src.Name): $_"
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
Write-Host "  Copying .claude\scripts\ dep-free scripts (generate-index.js, open-artifact.sh, render-html.js, session-init.js, pre-push-check.js, correction-ledger.js, gen-media.js) ..."
foreach ($name in @("generate-index.js", "open-artifact.sh", "render-html.js", "session-init.js", "pre-push-check.js", "correction-ledger.js", "gen-media.js")) {
  try {
    $src = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $name)
    $dest = Join-Path $Target (Join-Path ".claude\scripts" $name)
    Invoke-SafeCopy -Source $src -Destination $dest
  } catch {
    Write-Host "  Error: Failed to copy $name : $_"
    exit 1
  }
}

# --- Layout build, write-guard, chain-hook scripts and emitters (issue #144) --
# PARITY: mirrors setup.sh (issue #144 scripts, emitters, permission list) - change both together
# Dependency-free. build-layouts.js derives every other tool's layout from
# .claude\ (it runs further down, once every source file is in place);
# write-guard.js and chain-hook.js are the M2 and M14 guards outside Claude
# Code. The emitters under .claude\scripts\layouts\ are what build-layouts.js
# requires per tool, so they travel with it.
Write-Host "  Copying .claude\scripts\build-layouts.js, write-guard.js, chain-hook.js ..."
foreach ($name in @("build-layouts.js", "write-guard.js", "chain-hook.js")) {
  try {
    $src = Join-Path $ToolkitRoot (Join-Path ".claude\scripts" $name)
    $dest = Join-Path $Target (Join-Path ".claude\scripts" $name)
    Invoke-SafeCopy -Source $src -Destination $dest
  } catch {
    Write-Host "  Error: Failed to copy $name : $_"
    exit 1
  }
}
Write-Host "  Copying .claude\scripts\layouts\ ..."
$layoutsDest = Join-Path $Target ".claude\scripts\layouts"
New-Item -ItemType Directory -Force -Path $layoutsDest | Out-Null
foreach ($src in Get-ChildItem -Path $LayoutsSrcDir -Filter *.js -File -ErrorAction SilentlyContinue) {
  $dest = Join-Path $layoutsDest $src.Name
  try {
    Invoke-SafeCopy -Source $src.FullName -Destination $dest
  } catch {
    Write-Host "  Error: Failed to copy layouts\$($src.Name): $_"
    exit 1
  }
}

# --- Permission list (issue #144) ------------------------------
# The one committed, tool-agnostic list every translator reads. It replaced
# the tracked settings.local.json as the seed: the Claude Code translation is
# produced from it (fresh install) or merged from it (upgrade) further down.
Write-Host "  Copying .claude\toolkit-permissions.json ..."
try {
  Invoke-SafeCopy -Source (Join-Path $ToolkitRoot ".claude\toolkit-permissions.json") -Destination (Join-Path $Target ".claude\toolkit-permissions.json")
} catch {
  Write-Host "  Error: Failed to copy .claude\toolkit-permissions.json : $_"
  exit 1
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
# Whether the target brought its own .gitignore (mirrors GITIGNORE_PREEXISTED).
$gitignorePreexisted = Test-Path -LiteralPath $gitignoreDest -PathType Leaf
# $settingsIgnorePreexisted: whether the target's .gitignore already ignored
# .claude/settings.local.json before this run. The toolkit's own .gitignore
# carries that line since issue #144, so the merge (or the fresh copy) below
# normally brings it in; the report after the merge needs to know whether it
# was this run that added it. Mirrors SETTINGS_IGNORE_PREEXISTED.
$settingsIgnoreLine = ".claude/settings.local.json"
$settingsIgnorePreexisted = $false
if ($gitignorePreexisted -and (@((Read-ToolkitText -Path $gitignoreDest) -split "`r?`n") -ccontains $settingsIgnoreLine)) {
  $settingsIgnorePreexisted = $true
}
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

# --- Retire a bare .cursor/ ignore line (issue #144) -----------
# PARITY: mirrors setup.sh (bare .cursor/ line removal) - change both together
# The toolkit's .gitignore matches the directory as .cursor/* and re-includes
# the generated Cursor files by name. The merge above only adds lines, so a
# target that carried the old bare `.cursor/` keeps it, and git never
# descends into an excluded directory: every negation would be dead and the
# generated files would stay ignored. Removed the way the INDEX.md cleanup
# below edits the file (exact-line filter, backed up first unless the merge
# already saved the pre-run copy). Detected in the pre-flight ($PfCursorBare)
# and re-checked here so the report and the edit cannot drift.
if ($PfCursorBare) {
  $giText = Read-ToolkitText -Path $gitignoreDest
  $giLines = @($giText -split "`r?`n")
  if ($giLines -ccontains ".cursor/") {
    if (-not $script:GitignoreBackedUp) {
      Backup-File -Original $gitignoreDest
      $script:GitignoreBackedUp = $true
    }
    $giNewline = Get-ToolkitNewline -Text $giText
    $giKept = @($giLines | Where-Object { $_ -cne ".cursor/" })
    Write-ToolkitText -Path $gitignoreDest -Text ($giKept -join $giNewline)
    Write-Host "  Removed the bare .cursor/ line from .gitignore (the generated Cursor files are re-included by name)"
  }
}

# --- Ignore settings.local.json downstream --------------------
# PARITY: mirrors the settings.local.json ignore line in setup.sh - change both together
# Since issue #144 the toolkit repo no longer tracks .claude\settings.local.json:
# the permission seed is .claude\toolkit-permissions.json, translated per
# machine by build-layouts.js --claude-settings (below), and the toolkit's own
# .gitignore lists the file, so the merge above (or the fresh copy) normally
# brings the line in. This block is the fallback for a target .gitignore that
# still lacks it, and the one place the line is REPORTED either way. Downstream
# the file carries machine-specific absolute paths and the M11 tripwire refuses
# to push it, so a target that does not ignore it trips the tripwire on its
# first "git add -A" (holistic pass, fresh-install walk). An identical re-run
# finds the line, writes nothing, and says nothing.
$settingsIgnoreAdded = $false
$giNow = Read-ToolkitText -Path $gitignoreDest
if (-not (@($giNow -split "`r?`n") -ccontains $settingsIgnoreLine)) {
  if (-not $script:GitignoreBackedUp -and $gitignorePreexisted) {
    Backup-File -Original $gitignoreDest
    $script:GitignoreBackedUp = $true
  }
  $giNl = Get-ToolkitNewline -Text $giNow
  if ($giNow.Length -gt 0 -and -not $giNow.EndsWith("`n")) { $giNow += $giNl }
  $giNow += "# Local Claude Code permissions (machine-specific; setup merges new entries into it)" + $giNl + $settingsIgnoreLine + $giNl
  Write-ToolkitText -Path $gitignoreDest -Text $giNow
  $settingsIgnoreAdded = $true
} elseif (-not $settingsIgnorePreexisted) {
  # The merge or the fresh copy brought the line in during this run.
  $settingsIgnoreAdded = $true
}
# PARITY: mirrors the tracked settings.local.json warning in setup.sh - change both together
# An ignore line never untracks a file git already holds in its index, and
# pre-push-check.js deliberately exempts a never-push path that already
# exists at the remote base, so a downstream copy committed before this
# install kept going out on every push while the line below claimed
# "never pushed" (holistic review, R3). When git is on PATH, ask the
# index and warn instead: ls-files --error-unmatch exits 0 only for a
# tracked path, and fails the same way on a plain folder as on an
# untracked file, so a non-repo target keeps the plain message
# (Invoke-ToolkitGit keeps git's "fatal: not a git repository" from
# terminating the script under Stop). The untrack itself is the user's
# call - git rm --cached keeps the file on disk, but it is still a change
# to their repo - so setup never runs it. The warning repeats on every run
# while the file stays tracked: it is a live problem each time.
$settingsTracked = $false
if ($GitAvailable) {
  $settingsTracked = ((Invoke-ToolkitGit -Repo $Target -GitArgs @("ls-files", "--error-unmatch", "--", $settingsIgnoreLine)).ExitCode -eq 0)
}
if ($settingsIgnoreAdded -and -not $settingsTracked) {
  Write-Host "  Added $settingsIgnoreLine to .gitignore (machine-specific, never pushed)"
} elseif ($settingsIgnoreAdded) {
  Write-Host "  Added $settingsIgnoreLine to .gitignore"
}
if ($settingsTracked) {
  Write-Host "  WARNING: $settingsIgnoreLine is already tracked by git, and an ignore line does not untrack it."
  Write-Host "           It will keep being pushed until you run: git rm --cached $settingsIgnoreLine"
  Write-Host "           (the file stays on disk; git just stops tracking it)"
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

foreach ($f in @("CLAUDE.md", "LESSONS.md")) {
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

# --- Seed .claude\settings.local.json from the permission list (issue #144) -
# PARITY: mirrors setup.sh (settings.local.json seed) - change both together
# The tracked seed copy is gone: the toolkit repo ignores its own
# settings.local.json now, and the seed is .claude\toolkit-permissions.json.
# On a fresh install, build-layouts.js --claude-settings translates the list
# into Claude Code's grammar and writes the file (the merge below then adds
# this target's absolute-path browse.js entries). An existing file is the
# user's and is left to the merge. Without node nothing can be translated,
# so the command is named for later.
$buildLayoutsPath = Join-Path $Target ".claude\scripts\build-layouts.js"
if ($SettingsPreexisted) {
  Write-Host "  Skipping .claude\settings.local.json - already exists (yours to customize; new permissions are merged below)"
  $Skipped += ".claude\settings.local.json"
} elseif ($NodeAvailable) {
  Write-Host "  Seeding .claude\settings.local.json from .claude\toolkit-permissions.json ..."
  $seedRun = Invoke-ToolkitNodeFile -File $buildLayoutsPath -NodeArgs @("--root", $Target, "--claude-settings")
  if ($seedRun.ExitCode -ne 0) {
    Write-Host "  Warning: could not seed .claude\settings.local.json ($(Get-ToolkitFirstLine -Run $seedRun))."
    Write-Host "    Run later from the project root: node .claude\scripts\build-layouts.js --claude-settings"
  }
} else {
  Write-Host "  Note: node was not found, so .claude\settings.local.json was not seeded. Once node is"
  Write-Host "        installed, run from the project root: node .claude\scripts\build-layouts.js --claude-settings"
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

# --- DESIGN-PROFILE.md (seeded once from the installed template, issue #160) --
# PARITY: mirrors the DESIGN-PROFILE.md seed block in setup.sh - change both
# together. User-owned like CLAUDE.md and LESSONS.md: seeded on a fresh install,
# never overwritten. The seed is .claude\skills\shared\design-profile-template.md,
# which the shared glob above already copied into the target, so /explore can
# offer to recreate a missing profile from the very same file. Never this repo's
# own root file: a live profile would carry its answers into every fresh install.
$designProfileDest = Join-Path $Target "DESIGN-PROFILE.md"
if (Test-Path -LiteralPath $designProfileDest -PathType Leaf) {
  Write-Host "  Skipping DESIGN-PROFILE.md - already exists (yours to customize)"
  $Skipped += "DESIGN-PROFILE.md"
} else {
  Write-Host "  Copying DESIGN-PROFILE.md (seeded from .claude\skills\shared\design-profile-template.md) ..."
  try {
    Copy-Item -LiteralPath (Join-Path $ToolkitRoot ".claude\skills\shared\design-profile-template.md") -Destination $designProfileDest -Force
  } catch {
    Write-Host "  Error: Failed to copy DESIGN-PROFILE.md : $_"
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
# pre-existing one - see $SettingsPreexisted) and copies the .tmp onto it
# (why a copy and not a move is explained at that step). A no-op merge
# writes nothing, so an identical re-run makes no backup. A non-zero exit leaves the file untouched and prints a warning
# naming the error - stderr is kept apart from the change list, so a
# parse error can never print as a "+" permission line. Paths reach node
# through environment variables, never by interpolating them into the
# -e source (a past quoting bug).
# The script uses single quotes only: Windows PowerShell 5.1 drops
# embedded double quotes from arguments handed to native commands.
# Windows targets are C:\... paths, so the browse.js entries use forward
# slashes (the form a bash-style command line carries). Each installer
# manages only the path form it can vouch for (holistic-pass review): the
# stale-entry pattern is drive-letter only, so the POSIX-form entries
# setup.sh writes are left alone, and on a UNC target (\\wsl.localhost\...,
# whose flipped form //wsl.localhost/... never matches a real command
# line) no absolute entry is added or removed at all.
#
# Issue #144: the merge SOURCE is the Claude Code translation of
# .claude\toolkit-permissions.json, printed by build-layouts.js and written
# to a sibling file inside the target's .claude\ (the same writable place
# the .tmp uses), never the toolkit's own settings.local.json, which is no
# longer tracked. The inline node reads it from SRC_FILE. The print mode
# never reads the target's file, so an unparseable target still reaches
# the merge and gets the warning below, not a translation error.
$settingsDest = Join-Path $Target ".claude\settings.local.json"
$permsSrcFile = ""
if ((Test-Path -LiteralPath $settingsDest -PathType Leaf) -and $NodeAvailable) {
  $permsSrcFile = $settingsDest + ".tmp.src"
  if (Test-Path -LiteralPath $permsSrcFile) { Remove-Item -LiteralPath $permsSrcFile -Force }
  $permsSrcRun = Invoke-ToolkitNodeFile -File $buildLayoutsPath -NodeArgs @("--root", $Target, "--claude-settings", "--print")
  if ($permsSrcRun.ExitCode -ne 0) {
    $permsSrcFile = ""
    Write-Host "  Warning: could not translate .claude\toolkit-permissions.json (build-layouts.js --claude-settings --print exited $($permsSrcRun.ExitCode)),"
    Write-Host "    so the permission merge was skipped. Your .claude\settings.local.json was left unchanged."
  } else {
    $permsSrcUtf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($permsSrcFile, ((@($permsSrcRun.Lines) -join "`n") + "`n"), $permsSrcUtf8)
  }
}
if ($permsSrcFile -ne "") {
  $settingsTmp = $settingsDest + ".tmp"
  if (Test-Path -LiteralPath $settingsTmp) { Remove-Item -LiteralPath $settingsTmp -Force }
  $permsMergeJs = @'
    const fs = require('fs');
    const path = require('path');
    const targetDir = process.env.TARGET_DIR;
    const tgtPath = path.join(targetDir, '.claude', 'settings.local.json');
    const src = JSON.parse(fs.readFileSync(process.env.SRC_FILE, 'utf-8'));
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
    // to contain the target prefix. Drive-letter roots only: each installer
    // manages the path form it can vouch for, so the POSIX-form entries
    // setup.sh writes are left alone here, as setup.sh leaves the drive-letter
    // and UNC forms alone. A UNC target (\\server\share\...) is skipped
    // entirely - its flipped //server/share/... form never matches a real
    // command line, and removing the POSIX entries there was what set the two
    // installers undoing each other on alternating runs (holistic-pass review).
    const targetFwd = targetDir.replace(/\\/g, '/');
    const targetIsUnc = targetDir.startsWith('\\\\');
    const browsePattern = /^Bash\((echo|cat) \* \| node [A-Za-z]:\/.*\/(\.claude\/)?scripts\/browse\.js \*\)$/;
    const correctAbsEntries = new Set([
      'Bash(echo * | node ' + targetFwd + '/.claude/scripts/browse.js *)',
      'Bash(cat * | node ' + targetFwd + '/.claude/scripts/browse.js *)'
    ]);
    const staleAbs = targetIsUnc ? [] : tgtPerms.filter(p => browsePattern.test(p) && !correctAbsEntries.has(p));

    const stale = [...staleRel, ...staleAbs];
    tgtPerms = tgtPerms.filter(p => !stale.includes(p));

    // Step 3: add absolute-path browse.js permissions for the current target,
    // pointing at the new .claude/scripts/ location.
    const absPerms = [
      'Bash(echo * | node ' + targetFwd + '/.claude/scripts/browse.js *)',
      'Bash(cat * | node ' + targetFwd + '/.claude/scripts/browse.js *)'
    ];
    const absNew = targetIsUnc ? [] : absPerms.filter(p => !tgtPerms.includes(p));

    const allNew = [...missing, ...absNew];
    if (allNew.length > 0 || stale.length > 0) {
      tgt.permissions.allow = [...tgtPerms, ...allNew];
      // Written to the .tmp sibling; setup.ps1 backs up the live file and moves this into place.
      fs.writeFileSync(tgtPath + '.tmp', JSON.stringify(tgt, null, 2) + '\n');
      stale.forEach(p => console.log('removed: ' + p));
      allNew.forEach(p => console.log(p));
    }
'@
  $env:SRC_FILE = $permsSrcFile
  $env:TARGET_DIR = $Target
  $permsRun = Invoke-ToolkitNode -Script $permsMergeJs
  Remove-Item -Path Env:SRC_FILE, Env:TARGET_DIR -ErrorAction SilentlyContinue
  # The translation file has served its purpose whatever the merge did, so
  # nothing that fails below can leave it behind in .claude\.
  Remove-Item -LiteralPath $permsSrcFile -Force -ErrorAction SilentlyContinue
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
    # Copy-Item onto the live file, then drop the .tmp - not Move-Item over
    # it. A move replaces the directory entry, which severs a symlinked (or
    # hard-linked) settings.local.json - a dotfiles setup - so the link
    # target stopped receiving the merge. Copy-Item writes into the existing
    # file, so a link is written through. The manifest keeps its atomic
    # move: it is setup's own file, and atomicity matters more there
    # (holistic-pass review).
    Copy-Item -LiteralPath $settingsTmp -Destination $settingsDest -Force
    Remove-Item -LiteralPath $settingsTmp -Force
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

# --- Tool layouts: record the answer, clean, build (issue #144) -
# PARITY: mirrors setup.sh (tools record, clean, build) - change both together
# The answer resolved in the pre-flight is written here, after every source
# file is in place (build-layouts.js and its emitters were copied above, and
# the seeded CLAUDE.md feeds the AGENTS.md digest). Written byte-exact with
# an LF ending like the manifest, in the one-line shape the pre-flight
# parses; identical content is left alone so a re-run makes no backup. The
# file is committed downstream, so it is the repo's choice and reaches every
# collaborator. It never enters the manifest, and neither do the generated
# files: the build hashes its own output in .claude\.toolkit-generated.json.
$toolsJson = '{ "tools": [' + (Get-ToolsJsonList) + '] }'
$toolsCurrent = $null
if (Test-Path -LiteralPath $ToolsFile -PathType Leaf) {
  $toolsCurrent = (Read-ToolkitText -Path $ToolsFile).Replace("`r", "").TrimEnd("`n")
}
if ($null -ne $toolsCurrent -and $toolsCurrent -ceq $toolsJson) {
  # unchanged - nothing to write, nothing to back up
} else {
  if ($null -ne $toolsCurrent) { Backup-File -Original $ToolsFile }
  Write-ToolkitText -Path $ToolsFile -Text ($toolsJson + "`n")
  Write-Host ("  Recorded the tool layouts in " + $ToolsFileRel + ": " + (Get-ToolsList))
}

# A tool dropped from the recorded answer has its generated files removed.
# --clean reads the build's own record (which tools it last built), refuses
# a hand-edited generated file rather than deleting it, and takes only the
# toolkit's entries back out of a key-merged hooks.json.
if ($ToolsDropped.Count -gt 0) {
  if ($NodeAvailable) {
    foreach ($toolsName in $ToolsDropped) {
      $cleanRun = Invoke-ToolkitNodeFile -File $buildLayoutsPath -NodeArgs @("--root", $Target, "--clean", $toolsName)
      if ($cleanRun.ExitCode -eq 0) {
        $cleanSummary = Get-ToolkitFirstLine -Run $cleanRun
        $cleanPrefix = "build-layouts.js --clean " + $toolsName + ": "
        if ($cleanSummary.StartsWith($cleanPrefix)) { $cleanSummary = $cleanSummary.Substring($cleanPrefix.Length) }
        Write-Host "  Removed the generated $toolsName layout ($cleanSummary)"
      } else {
        Write-Host "  Warning: could not remove the generated $toolsName layout ($(Get-ToolkitFirstLine -Run $cleanRun))."
        Write-Host "    Run later from the project root: node .claude\scripts\build-layouts.js --clean $toolsName"
      }
    }
  } else {
    Write-Host "  Note: node was not found, so the generated layout(s) for $($ToolsDropped -join ' ') were not removed."
    Write-Host "        Once node is installed, run from the project root: node .claude\scripts\build-layouts.js --clean <tool>"
  }
}

# Build every recorded layout. build-layouts.js reads the answer just written,
# refuses to overwrite a hand-edited generated file (it names it; the user
# restores it or rebuilds with --force), and prints one summary line.
$LayoutsBuilt = $false
if ($script:ToolsChosen.Count -gt 0) {
  if ($NodeAvailable) {
    Write-Host "  Building the tool layouts for $(Get-ToolsList) ..."
    $buildRun = Invoke-ToolkitNodeFile -File $buildLayoutsPath -NodeArgs @("--root", $Target)
    foreach ($buildLine in @(@($buildRun.Lines) + @($buildRun.Errors))) {
      if (([string]$buildLine) -ne "") { Write-Host "    $buildLine" }
    }
    if ($buildRun.ExitCode -eq 0) {
      $LayoutsBuilt = $true
    } else {
      Write-Host "  Warning: build-layouts.js exited $($buildRun.ExitCode), so the layouts were not fully built."
      Write-Host "    Fix what it named above, then run from the project root: node .claude\scripts\build-layouts.js"
    }
  } else {
    Write-Host "  Note: node was not found, so the layouts for $(Get-ToolsList) were not built."
    Write-Host "        Once node is installed, run from the project root: node .claude\scripts\build-layouts.js"
  }
}

# --- Per-machine permission merges (issue #144) ----------------
# PARITY: mirrors setup.sh (per-machine merges) - change both together
# Cursor's editor and Antigravity read permissions from one file per machine,
# not per repo, so the translations the build wrote into the repo are merged
# into those files here: union on the allow list, every other key preserved,
# the toolkit's _generated marker never copied, a pre-existing file backed up
# before it changes, nothing written when it already holds every entry. node
# writes the merged result to a .tmp inside the target's .claude\ (known to
# be writable) and PowerShell copies it into place, the same shape as the
# settings.local.json merge above. Codex reads .codex\ per repo, but only
# once the project is trusted, so that one is an offer, never a silent
# write. $env:USERPROFILE is honored throughout ($UserHome, resolved above
# the pre-flight), so a test can redirect it. Paths reach node through the
# environment, never interpolated into the -e string, and the scripts use
# single quotes only (Windows PowerShell 5.1 drops embedded double quotes
# from native-command arguments).
if (Test-ToolsHas -Name "cursor") {
  $cursorSrc = Join-Path $Target ".cursor\permissions.toolkit.json"
  if (-not (Test-Path -LiteralPath $cursorSrc -PathType Leaf)) {
    Write-Host "  Cursor: .cursor\permissions.toolkit.json is not built yet, so nothing was merged into $CursorDst"
  } elseif (-not $NodeAvailable) {
    Write-Host "  Cursor: node was not found, so the allowlist merge into $CursorDst was skipped"
  } else {
    $cursorTmp = Join-Path $Target ".claude\.cursor-permissions.tmp"
    if (Test-Path -LiteralPath $cursorTmp) { Remove-Item -LiteralPath $cursorTmp -Force }
    $cursorMergeJs = @'
      const fs = require('fs');
      const src = JSON.parse(fs.readFileSync(process.env.SRC_FILE, 'utf-8'));
      const dst = fs.existsSync(process.env.DST_FILE) ? JSON.parse(fs.readFileSync(process.env.DST_FILE, 'utf-8')) : {};
      if (!Array.isArray(dst.terminalAllowlist)) dst.terminalAllowlist = [];
      const missing = (src.terminalAllowlist || []).filter(p => !dst.terminalAllowlist.includes(p));
      if (missing.length) {
        dst.terminalAllowlist = dst.terminalAllowlist.concat(missing);
        fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(dst, null, 2) + '\n');
      }
      console.log(missing.length);
'@
    $env:SRC_FILE = $cursorSrc
    $env:DST_FILE = $CursorDst
    $env:OUT_FILE = $cursorTmp
    $cursorRun = Invoke-ToolkitNode -Script $cursorMergeJs
    Remove-Item -Path Env:SRC_FILE, Env:DST_FILE, Env:OUT_FILE -ErrorAction SilentlyContinue
    if ($cursorRun.ExitCode -ne 0) {
      if (Test-Path -LiteralPath $cursorTmp) { Remove-Item -LiteralPath $cursorTmp -Force }
      Write-Host "  Warning: could not merge the Cursor allowlist into $CursorDst (is it valid JSON?)."
      Write-Host "    Copy the terminalAllowlist entries from .cursor\permissions.toolkit.json into it by hand."
    } elseif (Test-Path -LiteralPath $cursorTmp -PathType Leaf) {
      if (Test-Path -LiteralPath $CursorDst -PathType Leaf) { Backup-File -Original $CursorDst }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CursorDst) | Out-Null
      Copy-Item -LiteralPath $cursorTmp -Destination $CursorDst -Force
      Remove-Item -LiteralPath $cursorTmp -Force
      $cursorAdded = @(@($cursorRun.Lines) | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
      Write-Host "  Cursor: added $($cursorAdded -join '') terminal allowlist entries to $CursorDst"
      Write-Host "    That file is machine-global: every Cursor project on this machine now runs in Allowlist mode."
    } else {
      Write-Host "  Cursor: $CursorDst already holds every toolkit allowlist entry (machine-global)"
    }
  }
}

if (Test-ToolsHas -Name "antigravity") {
  $agSrc = Join-Path $Target ".agents\settings.toolkit.json"
  if (-not (Test-Path -LiteralPath $agSrc -PathType Leaf)) {
    Write-Host "  Antigravity: .agents\settings.toolkit.json is not built yet, so nothing was merged into $AgDst"
  } elseif (-not $NodeAvailable) {
    Write-Host "  Antigravity: node was not found, so the permission merge into $AgDst was skipped"
  } else {
    $agTmp = Join-Path $Target ".claude\.antigravity-settings.tmp"
    if (Test-Path -LiteralPath $agTmp) { Remove-Item -LiteralPath $agTmp -Force }
    # The workspace placeholder becomes this target's absolute path (no
    # trailing slash), exactly as the file's _note says: the committed file
    # must never carry a machine path, so the substitution happens here.
    $agMergeJs = @'
      const fs = require('fs');
      const src = JSON.parse(fs.readFileSync(process.env.SRC_FILE, 'utf-8'));
      const dst = fs.existsSync(process.env.DST_FILE) ? JSON.parse(fs.readFileSync(process.env.DST_FILE, 'utf-8')) : {};
      if (!dst.permissions || typeof dst.permissions !== 'object') dst.permissions = {};
      if (!Array.isArray(dst.permissions.allow)) dst.permissions.allow = [];
      const ws = process.env.WORKSPACE;
      const wanted = ((src.permissions && src.permissions.allow) || []).map(p => p.split('__WORKSPACE__').join(ws));
      const missing = wanted.filter(p => !dst.permissions.allow.includes(p));
      if (missing.length) {
        dst.permissions.allow = dst.permissions.allow.concat(missing);
        fs.writeFileSync(process.env.OUT_FILE, JSON.stringify(dst, null, 2) + '\n');
      }
      console.log(missing.length);
'@
    $env:SRC_FILE = $agSrc
    $env:DST_FILE = $AgDst
    $env:OUT_FILE = $agTmp
    $env:WORKSPACE = $Target
    $agRun = Invoke-ToolkitNode -Script $agMergeJs
    Remove-Item -Path Env:SRC_FILE, Env:DST_FILE, Env:OUT_FILE, Env:WORKSPACE -ErrorAction SilentlyContinue
    if ($agRun.ExitCode -ne 0) {
      if (Test-Path -LiteralPath $agTmp) { Remove-Item -LiteralPath $agTmp -Force }
      Write-Host "  Warning: could not merge the Antigravity permissions into $AgDst (is it valid JSON?)."
      Write-Host "    Copy the permissions.allow entries from .agents\settings.toolkit.json into it by hand,"
      Write-Host "    replacing __WORKSPACE__ with $Target"
    } elseif (Test-Path -LiteralPath $agTmp -PathType Leaf) {
      if (Test-Path -LiteralPath $AgDst -PathType Leaf) { Backup-File -Original $AgDst }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $AgDst) | Out-Null
      Copy-Item -LiteralPath $agTmp -Destination $AgDst -Force
      Remove-Item -LiteralPath $agTmp -Force
      $agAdded = @(@($agRun.Lines) | Where-Object { $_ -match '^\d+$' } | Select-Object -Last 1)
      Write-Host "  Antigravity: added $($agAdded -join '') permission entries to $AgDst (machine-global; the write_file rule names this project)"
    } else {
      Write-Host "  Antigravity: $AgDst already holds every toolkit permission entry (machine-global)"
    }
  }
}

if (Test-ToolsHas -Name "codex") {
  # A TOML basic string escapes every backslash, and every Windows path has
  # them, so the table header is written as [projects."C:\\Users\\me\\proj"]
  # - the form a TOML serializer emits for that path. setup.sh, whose paths
  # never carry a backslash, skips the write on one; here only a double
  # quote (impossible in a Windows path, but checked) is left to the user.
  $codexSection = '[projects."' + $Target.Replace('\', '\\') + '"]'
  $codexHasSection = $false
  if (Test-Path -LiteralPath $CodexCfg -PathType Leaf) {
    if ((Read-ToolkitText -Path $CodexCfg).Contains($codexSection)) { $codexHasSection = $true }
  }
  if ($codexHasSection) {
    Write-Host "  Codex: $CodexCfg already has a section for this project"
  } else {
    $codexWrite = $false
    if ($Target.Contains('"')) {
      Write-Host "  Codex: the target path contains a quote, so the trust section is not written automatically."
    } elseif (Test-ToolkitCanPrompt) {
      Write-Host "  Codex applies .codex\config.toml and .codex\rules\ only in a project it trusts."
      try {
        $codexReply = Read-Host "  Mark this project trusted in $CodexCfg? [y/N]"
        if ($codexReply -match '^(?i)(y|yes)$') { $codexWrite = $true }
      } catch {
        $codexWrite = $false
      }
    }
    if ($codexWrite) {
      $codexText = ""
      $codexNl = "`n"
      if (Test-Path -LiteralPath $CodexCfg -PathType Leaf) {
        Backup-File -Original $CodexCfg
        # End the existing content with a newline, then a blank separator
        # line before the new table; a file created here needs neither.
        $codexText = Read-ToolkitText -Path $CodexCfg
        $codexNl = Get-ToolkitNewline -Text $codexText
        if ($codexText.Length -gt 0 -and -not $codexText.EndsWith("`n")) { $codexText += $codexNl }
        $codexText += $codexNl
      }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $CodexCfg) | Out-Null
      $codexText += $codexSection + $codexNl + 'trust_level = "trusted"' + $codexNl
      Write-ToolkitText -Path $CodexCfg -Text $codexText
      Write-Host "  Codex: marked this project trusted in $CodexCfg"
    } else {
      Write-Host ("  Codex: to trust this project, add these two lines to " + $CodexCfg + ":")
      Write-Host "    $codexSection"
      Write-Host '    trust_level = "trusted"'
    }
  }
  Write-Host "  Codex: one-time step - open Codex in this project and run /hooks once to trust the toolkit's Stop hook (.codex\hooks.json)."
}

# --- Git pre-push hook (issue #144) ----------------------------
# PARITY: mirrors setup.sh (pre-push hook install) - change both together
# Acts on the plan the pre-flight computed ($HookState). Written byte-exact
# with LF endings and no BOM (Write-ToolkitText): git runs the hook through
# sh, which chokes on CRLF and on a BOM. There is no executable bit to set
# on Windows; git runs the file regardless. A differing toolkit hook is
# backed up before it is replaced, and a hook without the marker is never
# touched.
if ($HookState -eq "install" -or $HookState -eq "replace") {
  if ($HookState -eq "replace") { Backup-File -Original $HookFile }
  New-Item -ItemType Directory -Force -Path $HookDir | Out-Null
  Write-ToolkitText -Path $HookFile -Text (Get-HookContent)
  if ($HookState -eq "replace") {
    Write-Host "  Refreshed the git pre-push hook: $HookFile (runs the M11 tripwire before every push)"
  } else {
    Write-Host "  Installed the git pre-push hook: $HookFile (runs the M11 tripwire before every push)"
  }
} elseif ($HookState -eq "identical") {
  Write-Host "  Git pre-push hook already installed: $HookFile"
} elseif ($HookState -eq "foreign") {
  Write-Host "  Left the existing pre-push hook alone: $HookFile is not the toolkit's (no marker line)."
  Write-Host "    To run the tripwire from it, add: node .claude/scripts/pre-push-check.js"
} elseif ($HookState -eq "hooks-path") {
  Write-Host "  Skipping the git pre-push hook: core.hooksPath is set, so this repository's hooks live elsewhere."
  Write-Host "    Add 'node .claude/scripts/pre-push-check.js' to the pre-push hook there."
} elseif ($HookState -eq "other-root") {
  Write-Host "  Skipping the git pre-push hook: the target is inside a git repository rooted elsewhere."
} elseif ($HookState -eq "old-git") {
  Write-Host "  Skipping the git pre-push hook: this git cannot report its hooks directory (git rev-parse --git-path needs 2.5+)."
  Write-Host "    Add 'node .claude/scripts/pre-push-check.js' to .git\hooks\pre-push by hand."
} else {
  Write-Host "  Skipping the git pre-push hook: the target is not a git repository (run git init, then setup again)."
}

# --- Toolkit manifest (issue #138) -----------------------------
# Wholesale-regenerated on every real run (never on -DryRun, which exits
# above). Records the EOL-normalized sha256 of every managed file exactly
# as this run left it on disk - i.e. AFTER the version-stamp rewrites of
# the two rules files - so stamped files never self-flag on the next run.
# User-owned skip-if-exists files (CLAUDE.md, LESSONS.md,
# LESSONS-detail.md, DESIGN-PROFILE.md, .claude\settings.local.json) and the line-merged
# .gitignore are NOT tracked: setup never overwrites those, so they need
# no gate. ManagedRels is accumulated by the pre-flight enumeration,
# which mirrors the copy blocks exactly. Forward-slash keys and BOM-less
# UTF-8 with LF newlines keep it portable with setup.sh.
# Keys are written in ordinal order, which setup.sh matches with LC_ALL=C
# sort. Enumeration order differed between the two installers
# (Get-ChildItem order here - unsorted over UNC - and glob order there), so
# a target set up from both sides saw a different byte order every run and
# backed the manifest up each time (holistic-pass review). Sorted on the
# forward-slash key, the form both installers write.
$manifestKeys = [string[]]@($script:ManagedRels | ForEach-Object { $_.Replace('\', '/') })
[System.Array]::Sort($manifestKeys, [System.StringComparer]::Ordinal)
$manifestEntries = @()
foreach ($key in $manifestKeys) {
  $p = Join-Path $Target $key.Replace('/', '\')
  # Tolerate conditionally-shipped files (e.g. package-lock.json) that
  # were enumerated but not written this run.
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { continue }
  $h = Get-ToolkitFileHash -Path $p
  $manifestEntries += "    `"$key`": `"$h`""
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
# Fires on any upgrade that actually changed the version and that the
# upgrade notes box above did not cover, so a plain version bump never
# lands silently. $IsUpgrade alone is not enough: it is true whenever
# toolkit.md exists, so the box fired on every same-version re-run too.
# An empty $OldVersion (a pre-VERSION install) still differs, so that
# upgrade still gets the box (holistic-pass review). Version-neutral on
# purpose: the old text described one release (the v5.0 HTML viewing feature)
# and went stale on the next bump, so a v5.5 -> v6.0 upgrade read about
# HTML instead of auto-by-default. CHANGELOG.md and AGENT-SETUP.md are
# kept current by bump-version.sh, so this box only points at them;
# neither file is copied into the target, hence "in the toolkit repo".
# Mirrors the Bash block in setup.sh, gate included, now that the
# $LegacyCleaned and $PlansMigrated counters exist on this side too.
if ($IsUpgrade -and $OldVersion -ne $Version -and $LegacyCleaned -eq 0 -and $PlansMigrated -eq 0) {
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
Write-Host "           FAL_KEY         ->  https://fal.ai/dashboard/keys  (optional: video in the design workflow)"
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
Write-Host "    Tool layouts: $(Get-ToolsList). To add or remove one later, run setup"
Write-Host "    again with -Tools, e.g. -Tools codex,cursor (or -Tools none)."
Write-Host ""
