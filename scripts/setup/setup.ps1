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

Write-Host ""
Write-Host "  ================================"
Write-Host "   LLM Peer Review"
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
foreach ($f in @("ask-gpt.js", "ask-gemini.js")) {
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

foreach ($f in @("CLAUDE.md", ".env.local.example", ".claude\settings.local.json", ".gitignore", ".gitattributes")) {
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

Write-Host "  Copying .claude\commands\ ..."
foreach ($src in Get-ChildItem -Path $CommandsDir -Filter *.md -File) {
  $dest = Join-Path $Target (Join-Path ".claude\commands" $src.Name)
  if (Test-Path -LiteralPath $dest -PathType Leaf) {
    Write-Host "    [overwriting] $($src.Name) (back up first if you customized it)"
  }
  try {
    Copy-Item -LiteralPath $src.FullName -Destination $dest -Force
  } catch {
    Write-Host "  Error: Failed to copy $($src.Name): $_"
    exit 1
  }
}

Write-Host "  Copying scripts\ ..."
# Only copy runtime scripts (ask-gpt.js, ask-gemini.js) - setup scripts stay in toolkit repo
foreach ($scriptName in @("ask-gpt.js", "ask-gemini.js")) {
  try {
    Copy-Item -LiteralPath (Join-Path $ToolkitRoot (Join-Path "scripts" $scriptName)) -Destination (Join-Path $Target "scripts") -Force
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

# ─── .gitignore and .gitattributes (upstream-owned — always copy) ─
foreach ($gitFile in @(".gitignore", ".gitattributes")) {
  Write-Host "  Copying $gitFile ..."
  try {
    Copy-Item -LiteralPath (Join-Path $ToolkitRoot $gitFile) -Destination (Join-Path $Target $gitFile) -Force
  } catch {
    Write-Host "  Error: Failed to copy $gitFile : $_"
    exit 1
  }
}

foreach ($f in @("CLAUDE.md", ".claude\settings.local.json")) {
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
Write-Host "      3. Open the folder in Cursor and run /explore to start your first workflow."
Write-Host ""
Write-Host "      Steps 1 and 2 are optional - skip them if you don't"
Write-Host "      need /ask-gpt or /ask-gemini."
Write-Host ""
Write-Host "    Tip: To update commands and scripts, run setup again from"
Write-Host "    the toolkit repo: powershell -ExecutionPolicy Bypass -File `"$($MyInvocation.MyCommand.Path)`" -Target `"$Target`""
Write-Host ""
