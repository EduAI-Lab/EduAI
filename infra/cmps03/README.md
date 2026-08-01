# cmps03 — heavy/background vLLM fleet host

**Hardware:** 2× NVIDIA RTX 6000 Ada (48 GB each).

**Role (2026-07-31):** Run **Qwen3.5-35B-A3B** (MoE) across both GPUs as the
research secondary judge — per `docs/research/v3/PREREG_v3.md` §2.3, same
Qwen lineage as the dense answerer ladder, strictly larger than the selected
large tier, and never the model being judged. This host is separate from the
cmps01/cmps02 interactive Qwen chat pool.

Previously ran `gpt-oss-120b` for background/instructor-heavy jobs; that
role is now the rollback path (`deploy.sh`), not the default.

```text
s378 ──HTTP :8001──► nginx
                       └── LiteLLM 127.0.0.1:18091
                              └── vLLM 127.0.0.1:18001
                                      qwen3.5-35b-a3b, TP=2
```

## Deploy

```bash
cd ~/cmps03
chmod +x migrate-qwen35.sh
./migrate-qwen35.sh
docker logs -f eduai-vllm-moe
```

Verify:

```bash
curl -s http://127.0.0.1:8001/v1/models \
  -H "Authorization: Bearer vllm-local"
```

Configure the Core deployment on s378:

```env
VLLM_FLEET_HEAVY_URL="http://cmps03.ok.ubc.ca:8001"
VLLM_API_KEY="vllm-local"
```

Then run `npm run fleet:smoke` from `apps/core`.

The campus firewall must allow `s378` to reach
`cmps03.ok.ubc.ca` on TCP port `8001`.

## Qwen3.5 deploy note (Mamba cache limit)

The hybrid Gated-DeltaNet/Mamba architecture caps concurrent sequences by
available Mamba cache blocks, independent of `--gpu-memory-utilization`. If
vLLM logs `max_num_seqs (256) exceeds available Mamba cache blocks (N)` on
startup, the container will crash-loop under `--restart unless-stopped`. Fix:
stop/rm the container and recreate with `--max-num-seqs <N or lower>`.
`qwen3.5-35b-a3b` loaded cleanly at defaults on this host's TP=2 config; if a
future model on this host hits the limit, add the flag to `migrate-qwen35.sh`.

## Thinking mode

`docs/research/v3/PREREG_v3.md` §2.1 requires thinking mode **disabled** for
all research runs. Observed default: `qwen3.5-35b-a3b` emits a
`Thinking Process:` preamble unless the request explicitly passes
`chat_template_kwargs: {"enable_thinking": false}`. This is a per-request
concern for judge-call integration, not something `migrate-qwen35.sh` can
fix at the server level.

## Rollback to gpt-oss-120b

```bash
cd ~/cmps03
cp litellm-config.120b.yaml litellm-config.yaml
chmod +x deploy.sh start-edge.sh
./deploy.sh
docker logs -f eduai-vllm-120b
# once the backend reports ready:
./start-edge.sh
```
