# CMPS01 host

Last verified: 2026-08-31

CMPS01 is the repository-managed reference inference host. Its implementation
runbook and deployment scripts remain in [`../cmps01/README.md`](../cmps01/README.md).
This file records the host-specific fleet role and the latest verified inventory.

## Host-specific inventory

| Component | Binding | Served model or role |
| --- | --- | --- |
| `eduai-vllm` | `127.0.0.1:18001` | `qwen3.5-2b-instruct` |
| `eduai-vllm-t3` | `127.0.0.1:18002` | `qwen3.5-9b-instruct` |
| embedding backend | `127.0.0.1:18003` | `mxbai-embed-large` |
| LiteLLM | `127.0.0.1:18091` | Routes configured vLLM model IDs |
| nginx edge | host `:8001` | Authenticated public inference edge |
| energy sidecar | `127.0.0.1:9100` | Research energy measurements |
| Ollama | intended `127.0.0.1:11434` | Host-local auxiliary model service |

The authenticated port-8001 edge and all three direct backends returned HTTP 200
during the 2026-08-31 audit. The edge advertised the two Qwen IDs and
`mxbai-embed-large`.

## Runtime differences to preserve

- The repository migration target uses `vllm/vllm-openai:v0.27.1`; the live
  containers reported `vllm/vllm-openai:latest` during the audit.
- The repository's Qwen 3.5 9B target uses `--max-model-len 32768`; the live
  container reported `16384`. Capture and review runtime flags before replacing it.
- `18003` is currently occupied by embeddings. New vLLM backends must use the next
  confirmed free loopback port, not `18003`.
- Only nginx should be reachable on host port `8001`; raw backend and LiteLLM
  ports remain loopback-only.
- The intended Ollama binding is localhost-only. The audit observed `*:11434`,
  so run `verify-edge-security.sh` and resolve the binding before calling the
  host security-compliant.

## Change path

For model replacement, proxy changes, key validation, or firewall changes:

1. Read the shared fleet contract in [`./README.md`](./README.md).
2. Read the implementation runbook in [`../cmps01/README.md`](../cmps01/README.md).
3. Capture `docker inspect` and current model IDs before stopping anything.
4. Apply the reviewed change through `deploy-edge-proxy.sh` or `migrate.sh`.
5. Verify direct backends, authenticated port-8001, and the consuming EduAI
   environment without printing secrets.

