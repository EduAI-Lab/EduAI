# Load apps/core/.env + .env.research into the current PowerShell session.
# Usage (from apps/core):
#   . ./scripts/research/load-research-env.ps1
#   npm run research:run-both-tier

$coreDir = Resolve-Path (Join-Path $PSScriptRoot "../..")

function Import-DotEnvFile([string]$path) {
  if (-not (Test-Path $path)) { return }
  Get-Content $path | ForEach-Object {
    if ($_ -match '^\s*([^#=]+)=(.*)$') {
      $name = $matches[1].Trim()
      $value = $matches[2].Trim().Trim('"')
      Set-Item -Path "env:$name" -Value $value
    }
  }
}

Import-DotEnvFile (Join-Path $coreDir ".env")
Import-DotEnvFile (Join-Path $coreDir ".env.research")

if ($env:EDUAI_API_KEY -and -not $env:RESEARCH_RUN_X_API_KEY) {
  $env:RESEARCH_RUN_X_API_KEY = $env:EDUAI_API_KEY
}
if ($env:CHAT_BENCH_X_API_KEY -and -not $env:RESEARCH_RUN_X_API_KEY) {
  $env:RESEARCH_RUN_X_API_KEY = $env:CHAT_BENCH_X_API_KEY
}

Write-Host "Research env loaded. URL=$($env:RESEARCH_RUN_URL) LIMIT=$($env:RESEARCH_RUN_LIMIT)"
