# Issue #501 Tracks B + C from laptop against dev.eduai (Gemini chat + dev RAG).
# Prereq: .env.research from env.research.laptop.example with keys filled in.
#
# Usage (from apps/core):
#   . ./scripts/research/load-research-env.ps1
#   ./scripts/research/run-issue-501-laptop.ps1
#   ./scripts/research/run-issue-501-laptop.ps1 -SmokeOnly

param([switch]$SmokeOnly)

$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "../.."))

if (-not $env:RESEARCH_RUN_URL) { $env:RESEARCH_RUN_URL = "https://dev.eduai.ok.ubc.ca/api/chat" }
if (-not $env:RESEARCH_FIXED_MODEL) { $env:RESEARCH_FIXED_MODEL = "openai:google/gemini-2.5-flash" }
if (-not $env:RESEARCH_RUN_API_KEYS_FILE) {
  $env:RESEARCH_RUN_API_KEYS_FILE = "./scripts/research/research-api-keys.openrouter.json"
}
if (-not $env:RESEARCH_MEASURE_ENERGY) { $env:RESEARCH_MEASURE_ENERGY = "0" }
if (-not $env:RESEARCH_RUNS_DIR) {
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
  $env:RESEARCH_RUNS_DIR = Join-Path $repoRoot "docs\research\data\runs\issue-501-laptop"
}
New-Item -ItemType Directory -Force -Path $env:RESEARCH_RUNS_DIR | Out-Null

if (-not $env:RESEARCH_RUN_X_API_KEY -and -not $env:RESEARCH_RUN_COOKIE) {
  Write-Error @"
Set RESEARCH_RUN_X_API_KEY (better-auth admin API key from dev) or RESEARCH_RUN_COOKIE in .env.research.
EDUAI_API_KEY is the service Bearer key and does not work as x-api-key.
"@
}

if ($SmokeOnly) {
  $env:RESEARCH_RUN_LIMIT = "3"
  $env:RESEARCH_CLASSROOM_STUDENTS = "5"
}

if ($env:RESEARCH_PIPELINE_LABEL) { $label = $env:RESEARCH_PIPELINE_LABEL } else { $label = "laptop-openrouter" }
$model = $env:RESEARCH_FIXED_MODEL -replace ":", "-"

Write-Host "=== Track B smoke/sequential ($model) ==="
$env:RESEARCH_RUN_LABEL = "501-track-b-$model-$label"
$env:RESEARCH_POLICY_OUT = Join-Path $env:RESEARCH_RUNS_DIR "track-b-$model-$label.jsonl"
npm run research:run-policy
node scripts/research/summarize-issue-501.mjs $env:RESEARCH_POLICY_OUT

if ($SmokeOnly) { exit 0 }

Write-Host "=== Track C1 classroom (100 students, c=5) ==="
$env:RESEARCH_CLASSROOM_STUDENTS = "100"
$env:RESEARCH_CLASSROOM_CONCURRENCY = "5"
$env:RESEARCH_RUN_LABEL = "501-c1-$model-$label"
$env:RESEARCH_CLASSROOM_OUT = Join-Path $env:RESEARCH_RUNS_DIR "track-c1-$model-$label.jsonl"
$env:RESEARCH_CLASSROOM_SUMMARY = Join-Path $env:RESEARCH_RUNS_DIR "track-c1-$model-$label.txt"
Remove-Item Env:RESEARCH_RUN_LIMIT -ErrorAction SilentlyContinue
npm run research:run-classroom

Write-Host "=== Track C2 classroom (100 students, c=10) ==="
$env:RESEARCH_CLASSROOM_CONCURRENCY = "10"
$env:RESEARCH_RUN_LABEL = "501-c2-$model-$label"
$env:RESEARCH_CLASSROOM_OUT = Join-Path $env:RESEARCH_RUNS_DIR "track-c2-$model-$label.jsonl"
$env:RESEARCH_CLASSROOM_SUMMARY = Join-Path $env:RESEARCH_RUNS_DIR "track-c2-$model-$label.txt"
npm run research:run-classroom

Write-Host "Done. Outputs: $($env:RESEARCH_RUNS_DIR)"
