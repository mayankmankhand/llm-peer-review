# install-alias.ps1 - Install a convenient function for the setup script
#
# This adds a 'setup-claude-toolkit' command to your PowerShell profile that you can run from anywhere.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\install-alias.ps1
#
# This will add the function to your PowerShell profile.

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ToolkitRoot = Resolve-Path (Join-Path $ScriptDir "..")
$SetupScript = Join-Path $ToolkitRoot "scripts\setup.ps1"

# Get PowerShell profile path
if (-not $PROFILE) {
  Write-Host "Error: Could not determine PowerShell profile path"
  exit 1
}

$ProfilePath = $PROFILE

# Create profile directory if it doesn't exist
$ProfileDir = Split-Path -Parent $ProfilePath
if (-not (Test-Path -LiteralPath $ProfileDir -PathType Container)) {
  New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
}

# Create profile file if it doesn't exist
if (-not (Test-Path -LiteralPath $ProfilePath -PathType Leaf)) {
  New-Item -ItemType File -Force -Path $ProfilePath | Out-Null
  Write-Host "Created PowerShell profile at: $ProfilePath"
}

# Create function - escape path properly for here-string
$EscapedSetupScript = $SetupScript -replace '\\', '\\' -replace '"', '\"'

$Function = @"

# Claude Toolkit Setup - Added by install-alias.ps1
function setup-claude-toolkit {
  param(
    [string]`$Target = "."
  )
  
  if (`$Target -eq ".") {
    `$currentDir = (Get-Location).Path
    Write-Host "Setting up Claude Toolkit in: `$currentDir"
  } else {
    Write-Host "Setting up Claude Toolkit in: `$Target"
  }
  
  powershell -ExecutionPolicy Bypass -File "$EscapedSetupScript" -Target `$Target
}

"@

# Check if already installed
if (Test-Path -LiteralPath $ProfilePath -PathType Leaf) {
  $existingContent = Get-Content -LiteralPath $ProfilePath -Raw
  if ($existingContent -match "setup-claude-toolkit") {
    Write-Host "Function already exists in $ProfilePath"
    Write-Host "Skipping installation. To reinstall, remove the existing function first."
    exit 0
  }
}

# Add to profile
Add-Content -LiteralPath $ProfilePath -Value $Function

Write-Host "Added 'setup-claude-toolkit' function to $ProfilePath"
Write-Host ""
Write-Host "To use it:"
Write-Host "  1. Reload your PowerShell profile: . `$PROFILE"
Write-Host "     (Or restart PowerShell)"
Write-Host "  2. Run: setup-claude-toolkit C:\path\to\your-project"
Write-Host ""
Write-Host "Or from your project directory:"
Write-Host "  cd C:\path\to\your-project"
Write-Host "  setup-claude-toolkit ."
