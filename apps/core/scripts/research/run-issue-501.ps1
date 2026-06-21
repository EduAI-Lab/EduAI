# Issue #501 batch runner (PowerShell). See ISSUE_501_RUNBOOK.md.
#
# Usage:
#   .\scripts\research\run-issue-501.ps1 -PipelineLabel latest

param(
    [string]$PipelineLabel = "latest"
)

$ErrorActionPreference = "Stop"
$CoreDir = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$RunsDir = if ($env:RESEARCH_RUNS_DIR) { $env:RESEARCH_RUNS_DIR } else {
    Join-Path $CoreDir "..\..\docs\research\data\runs\issue-501"
}
$GitSha = try { git -C $CoreDir rev-parse --short HEAD } catch { "unknown" }
$Models = @("7B", "32B", "120B")

New-Item -ItemType Directory -Force -Path $RunsDir | Out-Null

$env:RESEARCH_PIPELINE_LABEL = $PipelineLabel
$env:RESEARCH_GIT_SHA = $GitSha
if (-not $env:RESEARCH_RUN_SPLIT) { $env:RESEARCH_RUN_SPLIT = "dev" }
if (-not $env:RESEARCH_RUN_SLEEP_MS) { $env:RESEARCH_RUN_SLEEP_MS = "500" }
if (-not $env:RESEARCH_MEASURE_ENERGY) { $env:RESEARCH_MEASURE_ENERGY = "0" }

Set-Location $CoreDir

function Run-TrackA {
    Write-Host "=== Track A: retrieval ($PipelineLabel) ==="
    $env:RESEARCH_RUN_LIMIT = "20"
    $env:RESEARCH_EVAL_RAG_OUT = Join-Path $RunsDir "track-a-$PipelineLabel.jsonl"
    $env:RESEARCH_EVAL_RAG_SUMMARY = Join-Path $RunsDir "track-a-$PipelineLabel-summary.txt"
    npm run research:eval-rag
}

function Run-TrackB([string]$Model) {
    Write-Host "=== Track B: sequential $Model ($PipelineLabel) ==="
    $env:RESEARCH_FIXED_MODEL = $Model
    $env:RESEARCH_RUN_LABEL = "501-track-b-$Model-$PipelineLabel"
    $env:RESEARCH_POLICY_OUT = Join-Path $RunsDir "track-b-$Model-$PipelineLabel.jsonl"
    Remove-Item Env:RESEARCH_RUN_LIMIT -ErrorAction SilentlyContinue
    npm run research:run-policy
    node scripts/research/summarize-issue-501.mjs $env:RESEARCH_POLICY_OUT
}

function Run-TrackC([string]$Model, [string]$Scenario, [int]$Students, [int]$Concurrency) {
    Write-Host "=== Track C: $Scenario $Model ($PipelineLabel) ==="
    $env:RESEARCH_FIXED_MODEL = $Model
    $env:RESEARCH_CLASSROOM_STUDENTS = "$Students"
    $env:RESEARCH_CLASSROOM_CONCURRENCY = "$Concurrency"
    if (-not $env:RESEARCH_CLASSROOM_SPLIT) { $env:RESEARCH_CLASSROOM_SPLIT = "dev" }
    $env:RESEARCH_RUN_LABEL = "501-$Scenario-$Model-$PipelineLabel"
    $env:RESEARCH_CLASSROOM_OUT = Join-Path $RunsDir "track-$Scenario-$Model-$PipelineLabel.jsonl"
    $env:RESEARCH_CLASSROOM_SUMMARY = Join-Path $RunsDir "track-$Scenario-$Model-$PipelineLabel.txt"
    if ($Model -eq "120B") {
        $env:RESEARCH_RUN_TIMEOUT_MS = "300000"
    } elseif (-not $env:RESEARCH_RUN_TIMEOUT_MS) {
        $env:RESEARCH_RUN_TIMEOUT_MS = "180000"
    }
    npm run research:run-classroom
}

$skip = $env:RESEARCH_ISSUE_501_SKIP ?? ""
if ($skip -notmatch "A") { Run-TrackA }
if ($skip -notmatch "B") {
    foreach ($m in $Models) { Run-TrackB $m }
}
if ($skip -notmatch "C") {
    foreach ($m in $Models) {
        Run-TrackC $m "c1" 100 5
        Run-TrackC $m "c2" 100 10
    }
}

Write-Host ""
Write-Host "=== Issue #501 batch complete ==="
Write-Host "pipeline: $PipelineLabel"
Write-Host "git: $GitSha"
Write-Host "outputs: $RunsDir"
