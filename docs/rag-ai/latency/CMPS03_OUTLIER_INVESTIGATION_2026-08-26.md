# cmps03 latency outlier — investigation (#1589)

**Test period:** August 26, 2026 UTC
**Related:** [#1589](https://github.com/EduAI-Lab/EduAI/issues/1589) (opened against
[PR #1582](https://github.com/EduAI-Lab/EduAI/pull/1582))
**Environment:** Direct native-vLLM calls on `cmps01` and `cmps03`, loopback only
(`127.0.0.1:18001` / `:18002`) — no EduAI Core, router, or public ingress involved.

## Summary

The August 19 report found cmps03 running the Qwen 3.5 2B/9B split roughly
**7–9x slower** than cmps01/cmps02 at concurrency 128 (p95 3,854 ms / 4,943 ms
on cmps03 vs. 438 ms / 638 ms and 463 ms / 638 ms on cmps01/cmps02). Issue
#1589 asked for the root cause: hardware metrics, container contention,
config diffs, and GPU/model assignment.

**Result: the outlier did not reproduce today, under any load shape tested.**
Repeating the same native-vLLM load shape (single-turn chat completions,
`max_tokens=200`) at concurrency 16, 32, 64, and 128 against both the 2B and
9B models on cmps01 and cmps03, one model at a time, shows matched
performance at every step, within normal run-to-run noise.

| Concurrency | Model | cmps01 p95 | cmps03 p95 |
|---:|---|---:|---:|
| 16 | 9B | 4.55 s | 4.55 s |
| 32 | 2B | 1.54 s | 1.52 s |
| 32 | 9B | 5.06 s | 5.07 s |
| 64 | 2B | 1.86 s | 1.88 s |
| 64 | 9B | 6.20 s | 6.18 s |
| 128 | 9B | 8.78 s | 8.76 s |

(128-concurrency 2B run was not repeated here; 16/32/64 already show parity.)

A follow-up pass also tried **combined dual-GPU load** — 128 concurrent
requests to the 2B model *and* 128 to the 9B model fired simultaneously on the
same host, saturating both GPUs at once, closer to the original report's
fleet-wide conditions than the single-model ladder above:

| Model | cmps01 p95 (combined) | cmps03 p95 (combined) |
|---|---:|---:|
| 2B | 2.84 s | 2.77 s |
| 9B | 8.75 s | 8.83 s |

Still no divergence — both GPUs on both hosts hit 100% utilization and
~300 W during the combined burst, temperatures peaked at 46 °C (cmps03) and
stayed well under any throttle range, and the two hosts tracked each other
within noise.

This means the specific outlier PR #1582 measured is not a standing, easily
reproduced property of the cmps03 host as it is configured and running today
— it held up under every load shape available without operator/sudo access,
including the closest approximation to the original dual-model test.

## What was ruled out (identical on both hosts)

- **GPU hardware:** both report two NVIDIA RTX 6000 Ada Generation cards,
  same max SM/mem clocks, same 300 W power limit, same PCIe gen4 x16 link
  capability.
- **Driver/CUDA:** both on driver `580.173.02`, CUDA 13.0.
- **vLLM launch flags:** `docker inspect` shows byte-identical `Cmd` arrays
  for both the 2B and 9B containers on both hosts (model id, served name,
  `--gpu-memory-utilization`, `--max-model-len 16384`, tool-call flags on the
  9B container).
- **Container resource limits:** unlimited (`NanoCpus=0`, `Memory=0`, no
  `CpusetCpus`/`CpusetMems` pin) on both hosts — no cgroup throttling
  configured either side.
- **Host CPU/NUMA/RAM:** identical `Xeon Gold 6426Y` (2 socket, 16 core/32
  thread each), identical NUMA layout, 503 GiB RAM on both.
- **GPU health signals (partial — see caveat below):** no PCIe replay-counter
  anomalies observed via `nvidia-smi`, and temperatures stayed ≤44 °C on
  cmps03 through the 128-concurrency burst (well under any throttle
  threshold) — matches the report's own conclusion that this is not a
  request-loss or crash issue. **`dmesg`/kernel-level Xid and hardware-fault
  history was *not* checked** — the deploy user does not have permission to
  read the kernel ring buffer on cmps03 (see "Not re-checked / still open"
  below), so this bullet is limited to what `nvidia-smi` observed during the
  test window and should not be read as a clean kernel-log audit.
- **Thermal/clock behavior under load:** on cmps03, GPU1 (9B) boosts to
  ~2,400–2,700 MHz / 100% util / ~290–300 W for several seconds under a
  128-concurrent burst, then drops to ~65–70 W / 0% util for the remainder of
  the request window — the same boost-then-idle shape observed on cmps01 at
  the same load level. Neither host showed sustained 100% GPU utilization for
  the full response window, meaning GPU compute is not the limiting resource
  for most of the wall-clock time on either host — batching/queueing in the
  vLLM scheduler dominates once requests are admitted, on both machines
  alike.

## Confirmed difference (does not explain the outlier)

- **vLLM version drift:** cmps01's `eduai-vllm-t3` container is running vLLM
  **0.27.1**; cmps03's is running vLLM **0.26.0**. Both deployed containers
  used the `vllm/vllm-openai:latest` image tag at inspection, so the hosts
  pulled `latest` at different times and have since diverged. This is a real
  deployment-drift issue worth fixing on its own, but it does not explain the
  reported outlier — cmps03 on the *older* vLLM version performed identically
  to cmps01 on the newer one in every test run above, including the
  combined-load pass.

  On this branch, the repository does not contain a CMPS03 compose file.
  The CMPS01 references relevant to this finding are `infra/cmps01/migrate.sh`
  and `infra/cmps01/README.md`; they document deployment guidance, not proof
  that either live host is currently pinned. Version pin standardization should
  be made in the deployment change that owns each host, including the separate
  CMPS03 deployment branch.

## Not re-checked / still open

- **GPU assignment / stale 35B-A3B configuration:** the active 2B/9B
  containers were compared for matching command-line flags, but the
  container-to-GPU mapping was not independently verified and stale
  35B-A3B configuration was not ruled out. This remains open and needs
  privileged host/container inspection.

- **PCIe link state at idle:** `nvidia-smi` reports
  `pcie.link.gen.current=1` (of a `max=4`) on both hosts while idle at P8
  power state. This is consistent with normal ASPM/power-saving link
  downshift and was identical on both hosts, so it isn't a cmps03-specific
  finding — but it wasn't verified to renegotiate to Gen4 under load on
  either host, since the sampler used here did not query PCIe state during
  the bursts.
- **`dmesg`/kernel logs:** the deploy user (`ssaada08`) does not have
  permission to read the kernel ring buffer or `sudo` non-interactively on
  cmps03 (`dmesg: read kernel buffer failed: Operation not permitted`;
  `sudo: a password is required`). Kernel-level throttle/error history —
  including Xid errors and any hardware-fault entries — is still unavailable
  without operator access, so the "GPU health signals" bullet above could
  **not** be corroborated at the kernel-log level; same access limitation
  noted for a different host in the s378 handoff.
- **ECC counters:** unsupported/`[N/A]` on both cards — expected for this
  GPU line, not a gap specific to this investigation.
- **The original report's exact conditions:** the August run also went
  through the public fleet router across all three servers at once (not two,
  as re-tested here) under an authenticated RAG-aware harness, rather than
  bare loopback `curl` against one host's two models. cmps02 was not
  re-tested (it had already been reassigned back to `Qwen2.5-32B-Instruct-AWQ`
  by the time of this pass), and the router/proxy layer itself was not
  exercised. It remains possible the outlier requires 3-server contention or
  router-level behavior to appear, or was tied to a transient host condition
  (noisy neighbor, thermal or memory-fragmentation state) that had already
  cleared by August 26.
- **Kernel/driver change history on cmps03:** without `dmesg`/`sudo`, there's
  no way to confirm whether anything changed on the host between Aug 19 and
  Aug 26 (reboot, driver update, BIOS power-profile change) that would
  explain a transient issue resolving on its own.

## Fleet readiness update (2026-08-28)

The load tests above were run directly against loopback vLLM
(`127.0.0.1:18001` / `:18002`) and never exercised the fleet router or
per-host service/proxy path. A separate s378 fleet smoke test run on
2026-08-28 checked that service path directly and found it degraded on
cmps03, independent of the loopback results above:

- `cmps01`: `/v1/models` healthy.
- `cmps02`: reachable, but currently missing the `qwen3.5-9b-instruct` model.
- `cmps03`: reachable, but `/v1/models` returns HTTP 400 with
  `{"type":"no_db_connection","message":"No connected db."}`.

The active s378 fleet configuration keeps all three hosts on the interactive
fleet — cmps03 is not being removed, only its earlier special heavy/background
routing role was retired. The smoke test itself reports "2/3 hosts healthy"
and exits successfully because its pass threshold is two hosts, but that
threshold masks a real gap: the fleet is operationally degraded until
cmps03's service/proxy database dependency (`no_db_connection`) is repaired.

This means the two results in this document should **not** be read together
as "cmps03 is healthy": the direct loopback vLLM load parity above supports
"the original 7–9x latency outlier was not reproduced at the vLLM layer,"
but it does not establish that the cmps03 proxy/API path (port 8001) that the
fleet actually routes through is healthy — that path is currently failing for
an unrelated reason (`no_db_connection`), not the latency outlier under
investigation here. Both are true at once: the outlier didn't reproduce, and
the host is currently degraded for a different, already-identified reason.

Full router/proxy-path validation against a repaired cmps03 is tracked
separately in [#1632](https://github.com/EduAI-Lab/EduAI/issues/1632)
(post-MVP fleet stress re-run after queue-aware routing), whose acceptance
criteria already require cmps03 to be "either remediated or its remaining
path-specific limitation... documented with evidence." This document's
closure recommendation below treats the `no_db_connection` finding as that
documented, currently-open limitation — not as something resolved by the
loopback tests above.

## Recommendation

Two load shapes have now been tried and both came back clean: the
single-model concurrency ladder (16–128) and combined dual-GPU saturation
(128+128). Both agree cmps03's vLLM layer currently performs identically to
cmps01's. That is a real result, not an inconclusive one — but it is a "not
reproducible," not a "fixed," and the two of us should not report it as
resolved. Separately, and not resolved by these tests, the 2026-08-28 fleet
smoke test above found cmps03's service/proxy path degraded
(`no_db_connection`); that is a distinct, currently-open issue tracked via
#1632, not evidence for or against the latency outlier.

- **Close #1589 as "not reproducible as of 2026-08-26,"** not as fixed.
  Record in the issue: two independent load shapes (isolated per-model
  ladder, and combined dual-model saturation) both showed cmps03's vLLM
  layer matching cmps01 within noise, so the original 7–9x gap is not a
  standing property of the host's current hardware/software/config state.
  Record alongside it that, as of 2026-08-28, cmps03 remains configured as an
  interactive fleet host but its service/proxy path is degraded/pending IT
  investigation (`no_db_connection`) — the host should not be described as
  fully ready until `/v1/models` succeeds through the same port-8001 path the
  fleet uses, and that follow-up is tracked in #1632.
- **Reopen if it recurs.** If the fleet stress test is rerun (e.g. for a
  future PR) and cmps03 shows the same outlier again, that would confirm the
  cause is either the full router/3-server path (untested here) or a
  transient host condition — both still open possibilities.
- **Before fully closing the loop**, it would still help to get operator
  sudo access on cmps03 once, to check `dmesg`/`journalctl` history for any
  reboot, driver, or power-profile event around Aug 19–26 — that's the one
  check that could turn "not reproducible" into an actual explanation. This
  is optional for closing #1589 now, not a blocker.
- **Done:** the version drift found along the way (`:latest` silently
  diverging cmps01 to 0.27.1 vs cmps03's 0.26.0) is fixed on cmps01's side in
  PR #1582 (commit `bb301f950`). cmps03's pin on the separate
  `codex/883-cmps03-heavy-fleet` branch was left as-is (out of scope).
- If the outlier recurs, repeat this ladder test *during* the event through
  the actual fleet router (not loopback) and capture `nvidia-smi dmon`
  (sub-second sampling) plus vLLM's `/metrics` (queue depth, KV-cache usage)
  rather than the coarse 1 Hz `nvidia-smi` snapshots used here.
