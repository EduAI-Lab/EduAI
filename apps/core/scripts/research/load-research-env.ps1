# Load apps/core/.env + .env.research into the current PowerShell session.
# Usage (from apps/core):
#   . ./scripts/research/load-research-env.ps1
#   npm run research:run-both-tier

$coreDir = Resolve-Path (Join-Path $PSScriptRoot "../..")
# Preserve explicit overrides set before sourcing (e.g. smoke-test another provider).
$preModel = $env:RESEARCH_FIXED_MODEL
$preKeysFile = $env:RESEARCH_RUN_API_KEYS_FILE

function Import-DotEnvFile([string]$path) {
  if (-not (Test-Path $path)) { return }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    if ($line -notmatch '^\s*([^#=]+)=(.*)$') { return }
    $name = $matches[1].Trim()
    $value = $matches[2].Trim()
    if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    $hash = $value.IndexOf(" #")
    if ($hash -ge 0) { $value = $value.Substring(0, $hash).Trim() }
    if ($value -eq "") { return }
    Set-Item -Path "env:$name" -Value $value
  }
}

Import-DotEnvFile (Join-Path $coreDir ".env")
Import-DotEnvFile (Join-Path $coreDir ".env.research")

if ($preModel) { $env:RESEARCH_FIXED_MODEL = $preModel }
if ($preKeysFile) { $env:RESEARCH_RUN_API_KEYS_FILE = $preKeysFile }

if (-not $env:RESEARCH_RUN_X_API_KEY -and $env:CHAT_BENCH_X_API_KEY) {
  $env:RESEARCH_RUN_X_API_KEY = $env:CHAT_BENCH_X_API_KEY
}
# Note: EDUAI_API_KEY is the service Bearer key (extensions), not the better-auth
# admin x-api-key. Do not map it to RESEARCH_RUN_X_API_KEY.

if (-not $env:RESEARCH_RUN_COOKIE) {
  $cookieFile = $env:RESEARCH_RUN_COOKIE_FILE
  if (-not $cookieFile) { $cookieFile = Join-Path $coreDir ".env.research.cookie" }
  if (Test-Path $cookieFile) {
    $env:RESEARCH_RUN_COOKIE = (Get-Content $cookieFile -Raw).Trim()
  }
}

function Write-ApiKeysFile([string]$relativePath, [object]$payload) {
  $resolved = Join-Path $coreDir $relativePath
  $dir = Split-Path $resolved -Parent
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  $json = ($payload | ConvertTo-Json -Depth 4 -Compress)
  $utf8NoBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($resolved, $json, $utf8NoBom)
  Write-Host "Wrote $relativePath"
}

$keysFile = $env:RESEARCH_RUN_API_KEYS_FILE
$openRouterKey = $env:OPENROUTER_API_KEY
$googleKey = $env:GOOGLE_GENERATIVE_AI_API_KEY

if ($keysFile -and $openRouterKey -and $keysFile -match "openrouter") {
  Write-ApiKeysFile $keysFile @{
    openai = @{
      apiKey    = $openRouterKey
      baseUrl   = "https://openrouter.ai/api/v1"
      isEnabled = $true
    }
  }
}
elseif ($keysFile -and $googleKey -and $keysFile -match "gemini") {
  Write-ApiKeysFile $keysFile @{
    google = @{ apiKey = $googleKey; isEnabled = $true }
  }
}
elseif ($openRouterKey -and -not $keysFile) {
  $env:RESEARCH_RUN_API_KEYS_FILE = "./scripts/research/research-api-keys.openrouter.json"
  if (-not $env:RESEARCH_FIXED_MODEL) { $env:RESEARCH_FIXED_MODEL = "openai:google/gemini-2.5-flash" }
  Write-ApiKeysFile $env:RESEARCH_RUN_API_KEYS_FILE @{
    openai = @{
      apiKey    = $openRouterKey
      baseUrl   = "https://openrouter.ai/api/v1"
      isEnabled = $true
    }
  }
}

Write-Host "Research env loaded."
Write-Host "  URL=$($env:RESEARCH_RUN_URL)"
Write-Host "  MODEL=$($env:RESEARCH_FIXED_MODEL)"
Write-Host "  ADMIN_KEY=$([bool]$env:RESEARCH_RUN_X_API_KEY)"
Write-Host "  COOKIE=$([bool]$env:RESEARCH_RUN_COOKIE)"
Write-Host "  API_KEYS_FILE=$($env:RESEARCH_RUN_API_KEYS_FILE)"
