# Fleet Router Work Handoff

Updated: 2026-08-23
Repository: EduAI-Lab/EduAI
Working directory: C:/Users/SyedS/Documents/UBCO Courses/URA/EduAICoreLearning

## Objective

Continue issue #1589: diagnose the cmps03 latency outlier, add queue-aware/model-aware fleet routing, and then deploy and stress-test the updated router through the development RAG/webapp path.

The requested stress ladder for the updated implementation is:

    16, 32, 64, 128, 256, 512, 768, 1000 concurrent users

The test must run through the authenticated RAG chat path on the development environment, not only directly against vLLM.

## Current GitHub state

- Draft PR: https://github.com/EduAI-Lab/EduAI/pull/1591
- Issue: https://github.com/EduAI-Lab/EduAI/issues/1589
- PR #1591 base: agent/fleet-router-hardening
- PR #1591 head: codex/issue-1589-performance
- PR #1591 is intentionally stacked on PR #1582.
- PR #1582 is the preceding fleet-router hardening/RAG stress-harness change. Once #1582 merges, retarget #1591 to development and verify the resulting diff.

The branch currently tracks the remote branch:

    eduai/codex/issue-1589-performance

The committed implementation is:

    f5a8c5c30 feat(core): add queue-aware fleet routing

## Secure SSH migration to another machine

Never paste, upload, commit, or print private-key contents. Do not ask an agent to read a private key into its context. The agent may inspect filenames, SSH config aliases, permissions, and connection results, but must keep key material opaque.

### Preferred method: create new keys on the new machine

This avoids moving private credentials at all.

1. On the new machine, create a dedicated Ed25519 key for each required trust boundary. Do not overwrite an existing key:

       ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_cmps03_new -C "new-machine cmps03 access"

2. Protect the key with a strong passphrase and load it into the new machine's OS SSH agent. On Windows PowerShell, use the OpenSSH Authentication Agent service if available.
3. Copy only the resulting .pub file to the administrator through an approved secure channel, or add its public-key line to the relevant account's authorized_keys using an already authenticated session.
4. Test the new alias with BatchMode enabled:

       ssh -o BatchMode=yes cmps03.ok.ubc.ca "hostname; whoami"

5. Only after successful testing, remove the old machine's public key from the server account if the old machine will be retired. Keep a separate recovery path until all required hosts have been verified.

### Fallback: preserve an existing key identity

Use this only if access control, automation, or an account policy requires the existing private key. Transfer it outside GitHub, chat, email, issue trackers, or ordinary cloud storage.

1. On the old machine, identify the exact files referenced by the SSH config. Copy only the required private key and config entries; do not blindly copy the entire .ssh directory. known_hosts can be regenerated on the new machine.
2. Put the required private key, its public key, and the relevant SSH config into an encrypted archive using an approved tool with AES-256 encryption and a long, unique passphrase.
3. Move the encrypted archive using an encrypted USB or an approved end-to-end encrypted file-transfer/password-manager vault. Send the archive passphrase through a different channel. Never put both archive and passphrase in the same message or location.
4. Verify the archive checksum out of band before opening it. Do not place the archive in the repository or a synchronized project folder.
5. On the new machine, extract into the user's SSH directory, remove the archive from both machines and any transfer service, and apply restrictive permissions.
6. On Windows PowerShell, after replacing the path and username as needed:

       $sshDir = Join-Path $env:USERPROFILE ".ssh"
       New-Item -ItemType Directory -Force $sshDir | Out-Null
       icacls $sshDir /inheritance:r
       icacls $sshDir /grant:r "$env:USERNAME:(OI)(CI)F"
       icacls (Join-Path $sshDir "id_ed25519_cmps03") /inheritance:r
       icacls (Join-Path $sshDir "id_ed25519_cmps03") /grant:r "$env:USERNAME:F"

7. Test the alias without exposing the key:

       ssh -o BatchMode=yes cmps03.ok.ubc.ca "hostname; whoami"

8. If the key was ever exposed outside the approved transfer path, assume compromise: revoke its public key from every server, generate a replacement, and update the SSH config.

### Current known SSH context

The prior cmps03 diagnostics used an SSH alias resolving to user ssaada08, port 22, and a key named id_ed25519_cmps03. Treat this as a hint only; inspect the old machine's SSH config and verify the exact identity path before transferring or regenerating anything. Do not copy these values into public documentation if the deployment's access policy changes.

## Important working-tree state

There are user-owned unrelated changes. Do not use git add -A, git add ., reset, checkout, or clean commands.

Currently unrelated files are:

    M  TESTS.md
    M  packages/types/dist/index.d.ts
    M  packages/types/dist/index.js
    ?? .worktrees/
    ?? docs/rag-ai/latency/eduai-summer-2026/FLEET_ROUTER_DATA_REPORT_2026-08-19.md
    ?? docs/rag-ai/latency/eduai-summer-2026/FLEET_ROUTER_EXECUTIVE_REPORT_2026-08-19.md
    ?? docs/rag-ai/latency/eduai-summer-2026/STRESS_TEST_RESULTS_2026-08-18.md

The only uncommitted files belonging to the current router review fix are:

    apps/core/app/lib/ai/routing/fleet/resolve-fleet.ts
    apps/core/app/tests/unit/fleet-routing.test.ts

## Implementation already committed

The original PR #1591 implementation contains these changes:

- apps/core/app/lib/ai/routing/fleet/load.ts
  - Tracks process-local active/queued work and an EWMA latency penalty per job type, server, and model.
  - Reserves a target before Core admission so queued requests influence future selection.
  - Uses Redis sorted-set reservations when REDIS_URL is configured, allowing multiple Core workers to see shared reservations.
  - Falls back to process-local accounting if Redis is unavailable.
  - Releases reservations idempotently after completion, failure, abort, or timeout.
- apps/core/app/lib/ai/routing/fleet/resolve-fleet.ts
  - Adds reserveLoad selection mode.
  - Preserves normal round-robin behavior for existing callers unless load reservation is explicitly requested.
  - Passes model identity into load accounting.
  - Preserves one-attempt alternate-host failover.
- apps/core/app/lib/ai/routing/fleet/types.ts
  - Adds the internal FleetLoadLease type to FleetPick.
- apps/core/app/routes/api/chat.ts
  - Re-picks immediately before admission with a load reservation.
  - Rebuilds the provider registry if the final selected server changes.
  - Marks/releases the reservation through admission and streaming lifecycle paths.
  - Reserves a new target during fleet failover.
- apps/core/app/tests/unit/fleet-routing.test.ts
  - Covers least-loaded selection and affinity behavior.
- infra/production/core.env.example
  - Documents the new fleet load settings:

    FLEET_LOAD_SHARED_STATE=true
    FLEET_LOAD_RESERVATION_TTL_MS=900000

## Review findings fixed locally but not yet committed

The review found two concrete defects in the original implementation:

1. Normal chat always supplied chat.id or actingUser.id as an affinity key. Since affinity was checked before load scoring, queue-aware routing was bypassed for normal webapp traffic. The fix keeps affinity sticky while allowing escape when the affinity target is materially more loaded (AFFINITY_LOAD_TOLERANCE = 2).
2. Background work falling back to the interactive chat pool used a separate background load key. The fix uses the effective pool key so fallback background work shares chat-server reservations.

New regression tests cover both cases:

- moves an affinity key when its target is materially more loaded
- shares load accounting when background work falls back to chat servers

To commit only these fixes, use:

    git add -- apps/core/app/lib/ai/routing/fleet/resolve-fleet.ts apps/core/app/tests/unit/fleet-routing.test.ts
    git diff --cached --check
    git commit -m "fix(core): honor load-aware fleet affinity"
    git push eduai codex/issue-1589-performance

Do not stage the unrelated files listed above.

## Validation status

Completed:

- cmps03 native vLLM comparison against cmps01.
- git diff --check passes for the router changes.
- Direct Core TypeScript checking found no errors in the changed router files.

Blocked locally by the incomplete dependency install:

- Focused unit command:

    npm run test:unit -w edu-ai -- app/tests/unit/fleet-routing.test.ts

  currently fails before loading tests because happy-dom is missing.

- Full Core TypeScript check:

    node_modules/.bin/tsc -p apps/core/tsconfig.json --noEmit

  currently reports existing repository problems involving missing p-limit, missing node:fs/promises declarations, and unrelated file-processing.ts errors.

On the next machine, install dependencies using the repository's normal lockfile workflow, then rerun the focused test and type check. Do not change the lockfile merely to work around the current machine unless that is an intentional task.

## cmps03 findings

Read-only diagnostics found cmps03 and cmps01 using the same relevant configuration:

- NVIDIA RTX 6000 Ada GPUs
- Driver 580.173.02
- Same PCIe/topology characteristics
- Same vLLM model placement and launch arguments
- Same Docker resource settings

Controlled native vLLM runs at 128 concurrent requests were close enough that cmps03 is not currently a native backend outlier:

| Model | Host | RPS | Output tok/s | Mean TTFT | p99 TTFT |
|---|---:|---:|---:|---:|---:|
| Qwen 3.5 2B | cmps03 | 63.96 | 4,093.69 | 722 ms | 1,169 ms |
| Qwen 3.5 2B | cmps01 | 64.75 | 4,144.24 | 705 ms | 1,174 ms |
| Qwen 3.5 9B | cmps03 | 16.71 | 1,069.19 | 2,759 ms | 5,140 ms |
| Qwen 3.5 9B | cmps01 | 17.20 | 1,100.87 | 2,650 ms | 4,899 ms |

No model/container change was made on cmps03. The earlier large cmps03 p95 result should be investigated through the proxy/harness/RAG path rather than treated as proof of a GPU configuration fault.

## Required next steps

### 1. Commit and push the review fix

Use the explicit file list above. Confirm the commit contains only the two review-fix files. Then verify PR #1591 shows the new commit.

### 2. Finish automated validation

After a clean dependency install, run:

    npm run test:unit -w edu-ai -- app/tests/unit/fleet-routing.test.ts
    node_modules/.bin/tsc -p apps/core/tsconfig.json --noEmit
    git diff --check

Record whether failures are in the changed files or pre-existing repository/dependency failures.

### 3. Deploy the PR branch to development

Deploy the PR branch to the development Core/RAG path on s378 using the project's normal deployment procedure. Do not test the unmerged branch against production. Confirm Redis is configured if cross-worker reservation visibility is part of the test.

Before load testing, perform one authenticated webapp/RAG chat and a follow-up question through dev.eduai.ok.ubc.ca. Verify and record:

- stable chatId
- expected citations
- RAG retrieval results
- X-Fleet-Server
- context continuity on the follow-up
- selected model and server in application telemetry

### 4. Run the updated RAG/webapp stress ladder

Use the realistic webapp path, not only direct vLLM. Run separate controlled levels at:

    16, 32, 64, 128, 256, 512, 768, 1000 concurrent users

Record at each level:

- request count, success count, failure count
- application p50/p95/p99 latency
- RAG retrieval latency
- model generation/stream startup latency
- admission wait time and admission timeouts
- retries and fleetRetry outcomes
- rate limiting and 429/503 responses
- server/model distribution and X-Fleet-Server
- Redis reservation behavior and errors
- database pool/errors/latency
- context continuity for repeated turns
- per-server GPU utilization, memory, power, and thermal state

The prior 1–128 graphs and artifacts must not be presented as the post-review 1–1000 result. Create new timestamped artifacts for this branch and clearly distinguish direct-vLLM, Core chat API, and RAG/webapp runs.

### 5. Restore the requested model state

After testing, restore qwen2.5-32b-instruct on cmps02 GPU1 as previously requested. Confirm the running model and GPU placement after restoration and document the exact command/configuration used.

### 6. Update documentation

Keep two result documents:

- Executive report with conclusions and graphs.
- Data report with raw tables, per-server results, ladder results, and artifacts.

Add the new post-review results to both only after the RAG/webapp ladder has actually completed.

## Safety and handoff cautions

- Do not claim the queue-aware router improved p95 until the updated branch has been deployed and measured.
- Do not infer RAG/webapp behavior from direct vLLM results.
- Do not delete, reset, or stage the unrelated report/working-tree files.
- Keep PR #1591 draft until automated and development stress validation are complete.
- If PR #1582 merges first, retarget #1591 to development and inspect the merge diff for duplicate/conflicting changes.
