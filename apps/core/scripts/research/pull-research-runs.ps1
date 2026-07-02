# Pull research run artifacts from GPU hosts into URA docs/research/data.
# Usage (from apps/core): .\scripts\research\pull-research-runs.ps1

$CoreDir = Resolve-Path (Join-Path $PSScriptRoot "../..")
$DataDir = if ($env:RESEARCH_DATA_DIR) { $env:RESEARCH_DATA_DIR } else {
    Resolve-Path (Join-Path $CoreDir "../../../docs/research/data")
}
$HostFilter = if ($env:RESEARCH_PULL_HOST) { $env:RESEARCH_PULL_HOST } else { "cmps02" }

$adequacyDir = Join-Path $DataDir "runs/adequacy"
$statusDir = Join-Path $DataDir "runs/status"
New-Item -ItemType Directory -Force -Path $adequacyDir, $statusDir | Out-Null

if ($HostFilter -eq "cmps02" -or $HostFilter -eq "all") {
    Write-Host "=== pull cmps02 adequacy runs ==="
    scp cmps02:~/cmps02/adequacy-72b-hard-v1.jsonl (Join-Path $adequacyDir "adequacy-72b-hard-v1.jsonl")
    scp cmps02:~/cmps02/adequacy-72b-hard.log (Join-Path $adequacyDir "adequacy-72b-hard.log") 2>$null
    scp cmps02:~/cmps02/adequacy-prompts-hard.jsonl (Join-Path $adequacyDir "adequacy-prompts-hard.jsonl") 2>$null
}

Write-Host ""
Write-Host "=== post-pull: rebuild matrix ==="
Push-Location $CoreDir
npm run research:build-matrix
Pop-Location

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHHmmZ")
$statusFile = Join-Path $statusDir "research-pull-$stamp.md"
@"
# Research pull — $stamp

- Host: ``$HostFilter``
- Adequacy: ``runs/adequacy/adequacy-72b-hard-v1.jsonl``
- Matrix refreshed: ``data/analysis/prompt-routing-matrix.csv``

Agents: update ``findings/ADEQUACY_LADDER_STATUS.md`` after new adequacy JSONL lands.
"@ | Set-Content -Path $statusFile -Encoding utf8

Write-Host "Wrote $statusFile"
Write-Host "Done. Data dir: $DataDir"
