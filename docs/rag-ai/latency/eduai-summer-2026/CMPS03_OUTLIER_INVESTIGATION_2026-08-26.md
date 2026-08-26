# cmps03 latency outlier — investigation (#1589)

**Test period:** August 26, 2026 UTC
**Related:** [#1589](https://github.com/EduAI-Lab/EduAI/issues/1589) (opened against
[PR #1582](https://github.com/EduAI-Lab/EduAI/pull/1582) /
[`FLEET_ROUTER_EXECUTIVE_REPORT_2026-08-19.md`](./FLEET_ROUTER_EXECUTIVE_REPORT_2026-08-19.md))
**Environment:** Direct native-vLLM calls on `cmps01` and `cmps03`, loopback only
(`127.0.0.1:18001` / `:18002`) — no EduAI Core, router, or public ingress involved.

## Summary

The August 19 report found cmps03 running the Qwen 3.5 2B/9B split roughly
**7–9x slower** than cmps01/cmps02 at concurrency 128 (p95 3,854 ms / 4,943 ms
on cmps03 vs. 438 ms / 638 ms and 463 ms / 638 ms on cmps01/cmps02). Issue
#1589 asked for the root cause: hardware metrics, container contention,
config diffs, and GPU/model assignment.

**Result: the outlier did not reproduce today.** Repeating the same native-vLLM
load shape (single-turn chat completions, `max_tokens=200`) at concurrency 16,
32, 64, and 128 against both the 2B and 9B models on cmps01 and cmps03 shows
matched performance at every step, within normal run-to-run noise.

| Concurrency | Model | cmps01 p95 | cmps03 p95 |
|---:|---|---:|---:|
| 16 | 9B | 4.55 s | 4.55 s |
| 32 | 2B | 1.54 s | 1.52 s |
| 32 | 9B | 5.06 s | 5.07 s |
| 64 | 2B | 1.86 s | 1.88 s |
| 64 | 9B | 6.20 s | 6.18 s |
| 128 | 9B | 8.78 s | 8.76 s |

(128-concurrency 2B run was not repeated here; 16/32/64 already show parity.)

This means the specific outlier PR #1582 measured is not a standing, easily
reproduced property of the cmps03 host as it is configured and running today.

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
- **GPU health signals:** no Xid errors or hardware faults in `dmesg` on
  cmps03; no PCIe replay-counter anomalies observed; temperatures stayed
  ≤44 °C on cmps03 through the 128-concurrency burst (well under any
  throttle threshold) — matches the report's own conclusion that this is not
  a request-loss or crash issue.
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
  **0.27.1**; cmps03's is running vLLM **0.26.0**. Both containers use the
  `vllm/vllm-openai:latest` image tag (not the `v0.26.0` pin recorded in
  `infra/cmps01/docker-compose.yml` and `infra/cmps03/docker-compose.yml` in
  this repo), so the two hosts pulled `latest` at different times and have
  since diverged. This is a real config-drift bug worth fixing on its own
  (repo-pinned versions no longer match what's deployed on either host), but
  it does not explain the reported outlier — cmps03 on the *older* vLLM
  version performed identically to cmps01 on the newer one in every test run
  above.

## Not re-checked / still open

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
  `sudo: a password is required`). Kernel-level throttle/error history is
  still unavailable without operator access — same limitation noted for a
  different host in the s378 handoff.
- **ECC counters:** unsupported/`[N/A]` on both cards — expected for this
  GPU line, not a gap specific to this investigation.
- **The original report's exact conditions:** the August run used the fleet
  fully loaded (2B **and** 9B concurrently, plus router/RAG overhead) and ran
  through the public fleet router across all three servers at once, not one
  model in isolation via loopback as done here. It's possible the outlier
  only appears under combined multi-model contention on cmps03's two GPUs,
  or under sustained (not single-burst) load, or was tied to a transient
  host condition (e.g., a noisy neighbor process, a since-cleared thermal or
  memory-fragmentation state) that resolved between August 19 and today.
  Neither cmps02 nor the full 3-server router path was re-tested here.

## Recommendation

- Treat the original 7–9x cmps03 outlier as **not currently reproducible**
  rather than fixed — the underlying cause was never identified, so it could
  recur under conditions not covered by this pass (combined 2B+9B load,
  sustained duration, full router path, or a transient host state).
- Before closing #1589, get operator/sudo access on cmps03 to pull `dmesg`
  history and confirm nothing changed on the host between Aug 19 and now
  (reboot, driver update, BIOS power-profile change) that would explain a
  transient issue self-resolving.
- Separately, fix the version drift: re-pin and redeploy both hosts to the
  same explicit vLLM version (not `:latest`) so `docker-compose.yml` in the
  repo matches what's actually running, and so future comparisons aren't
  confounded by silent image drift.
- If the outlier recurs, repeat this same loopback ladder test *during* the
  event and capture `nvidia-smi dmon` (sub-second sampling) plus vLLM's
  `/metrics` (queue depth, KV-cache usage) rather than the coarse 1 Hz
  `nvidia-smi` snapshots used here.
