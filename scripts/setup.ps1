# setup.ps1 — Copy the Cursor Slash Command Toolkit into any project (Windows PowerShell).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -Target "C:\path\to\project"
#
# If -Target is omitted, uses the current working directory.

param(
  [string]$Target = "."
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolkitRoot = Resolve-Path (Join-Path $ScriptDir "..")

if (-not (Test-Path -LiteralPath $Target -PathType Container)) {
  Write-Host ""
  Write-Host "  Error: target directory does not exist: $Target"
  Write-Host "  Create it first:  New-Item -ItemType Directory -Path '$Target'"
  Write-Host ""
  exit 1
}

$Target = (Resolve-Path -LiteralPath $Target).Path

Write-Host ""
Write-Host "  ================================"
Write-Host "   Cursor Slash Command Toolkit"
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

foreach ($f in @("dev-lead-gpt.js", "dev-lead-gemini.js", "setup.sh", "setup.ps1")) {
  $p = Join-Path $ToolkitRoot (Join-Path "scripts" $f)
  if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {
    Write-Host "  Error: source file not found: $p"
    $PreflightOk = $false
  }
}

foreach ($f in @("CLAUDE.md", ".env.local.example", ".claude\settings.local.json")) {
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

New-Item -ItemType Directory -Force -Path (Join-Path $Target ".claude\commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Target "scripts") | Out-Null

$Skipped = @()

Write-Host "  Copying .claude/commands/ ..."
foreach ($src in Get-ChildItem -Path $CommandsDir -Filter *.md -File) {
  $dest = Join-Path $Target (Join-Path ".claude\commands" $src.Name)
  if (Test-Path -LiteralPath $dest -PathType Leaf) {
    Write-Host "    ↻ overwriting $($src.Name) (back up first if you customized it)"
  }
  Copy-Item -LiteralPath $src.FullName -Destination $dest -Force
}

Write-Host "  Copying scripts/ ..."
foreach ($scriptName in @("dev-lead-gpt.js", "dev-lead-gemini.js", "setup.sh", "setup.ps1")) {
  Copy-Item -LiteralPath (Join-Path $ToolkitRoot (Join-Path "scripts" $scriptName)) -Destination (Join-Path $Target "scripts") -Force
}

Write-Host "  Copying .env.local.example ..."
Copy-Item -LiteralPath (Join-Path $ToolkitRoot ".env.local.example") -Destination (Join-Path $Target ".env.local.example") -Force

foreach ($f in @("CLAUDE.md", ".claude\settings.local.json")) {
  $src = Join-Path $ToolkitRoot $f
  $dest = Join-Path $Target $f
  if (Test-Path -LiteralPath $dest -PathType Leaf) {
    Write-Host "  Skipping $f — already exists (yours to customize)"
    $Skipped += $f
  } else {
    Write-Host "  Copying $f ..."
    Copy-Item -LiteralPath $src -Destination $dest -Force
  }
}

Write-Host ""
Write-Host "  ================================"
Write-Host "   Done"
Write-Host "  ================================"
Write-Host ""

if ($Skipped.Count -gt 0) {
  Write-Host "    Skipped (already existed — not overwritten):"
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
Write-Host "           OPENAI_API_KEY  →  https://platform.openai.com/api-keys"
Write-Host "           GEMINI_API_KEY  →  https://aistudio.google.com/apikey"
Write-Host ""
Write-Host "      3. Open the folder in Cursor and type / to see your commands."
Write-Host ""
Write-Host "      Steps 1 and 2 are optional — skip them if you don't"
Write-Host "      need /dev-lead-gpt or /dev-lead-gemini."
Write-Host ""
Write-Host "    Tip: This copy of setup scripts is a snapshot. Run from"
Write-Host "    the toolkit repo for updates in the future."
Write-Host ""
