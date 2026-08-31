# CMPS02 host

Last verified: 2026-08-31

CMPS02 is a heterogeneous inference host. Its current large-model backend is
Qwen 2.5 32B for the Assist Auto capability, not the standard Qwen 3.5 9B tier.
This file is a host snapshot and role boundary; the shared implementation
procedure is [`../cmps01/README.md`](../cmps01/README.md).

## Host-specific inventory

| Component | Binding | Served model or role |
| --- | --- | --- |
| `eduai-vllm` | `127.0.0.1:18001` | `qwen3.5-2b-instruct` |
| `eduai-vllm-t3` | `127.0.0.1:18002` | `qwen2.5-32b-instruct` for Assist Auto |
| LiteLLM | `127.0.0.1:18091` | Routes configured vLLM model IDs |
| nginx edge | host `:8001` | Authenticated public inference edge |
| Ollama | no listener observed on `11434` | Not currently available on this host |

The direct backends returned HTTP 200 and the authenticated port-8001 edge
returned HTTP 200 during the 2026-08-31 audit. The edge advertised
`qwen3.5-2b-instruct` and `qwen2.5-32b-instruct`.

## Role boundary

- Use `qwen3.5-2b-instruct` as the small tier where the application selects it.
- Treat `qwen2.5-32b-instruct` as the separate Assist Auto capability.
- Do not label the 32B model as the standard large tier; that name is reserved
  for `qwen3.5-9b-instruct` where installed.
- Do not assume CMPS02 has an embedding backend or Ollama service; none was
  observed during the audit.
- Keep backend ports `18001`, `18002`, and `18091` loopback-only.

## Change path

Before changing CMPS02:

1. Confirm the intended model role and consuming application configuration.
2. Capture `docker inspect` output, GPU assignment, image tag, and model IDs.
3. Review the shared fleet contract in [`./README.md`](./README.md).
4. Adapt the CMPS01 implementation procedure to this host and have the change
   reviewed before stopping a live backend.
5. Verify the authenticated edge and the exact model IDs after the change.

