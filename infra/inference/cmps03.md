# CMPS03 host

Last verified: 2026-09-02

CMPS03 has the standard Qwen 3.5 small/large pair and is healthy on its
authenticated port-8001 edge. It is available for the same interactive fleet
role as CMPS01.

The shared implementation procedure is
[`../cmps01/README.md`](../cmps01/README.md); adapt it to CMPS03's GPU, model,
and port assignments before making host changes.

## Host-specific inventory

| Component | Binding | Served model or role |
| --- | --- | --- |
| `eduai-vllm` | `127.0.0.1:18001` | `qwen3.5-2b-instruct` |
| `eduai-vllm-t3` | `127.0.0.1:18002` | `qwen3.5-9b-instruct` |
| LiteLLM | `127.0.0.1:18091` | Routes configured vLLM model IDs |
| nginx edge | host `:8001` | Authenticated public inference edge |
| Ollama | no listener observed on `11434` | Not currently available on this host |

The direct vLLM backends and authenticated port-8001 edge returned HTTP 200
during the 2026-09-02 verification. The edge advertised both expected model IDs.

## Readiness and key alignment

- Keep CMPS03's host-scoped declarations aligned with the two models it advertises.
- The previous `HTTP 400 no_db_connection` / `No connected db.` response was
  caused by the CMPS03 LiteLLM `master_key` not matching Core's `VLLM_API_KEY`.
- This deployment is DB-less; the error did not mean that a new LiteLLM database
  was required. If it returns again, verify the shared key and restart the edge
  proxy after changing its secret.

## Recovery verification

Run the authenticated check from an approved server without printing the key:

```bash
curl -fsS --max-time 10 \
  -H "Authorization: Bearer \${VLLM_API_KEY}" \
  http://cmps03.ok.ubc.ca:8001/v1/models
```

Confirm that the response is HTTP 200 and includes
`qwen3.5-2b-instruct` and `qwen3.5-9b-instruct`. Then test the consuming
application and record the timestamp, commit/image, model IDs, and role.
