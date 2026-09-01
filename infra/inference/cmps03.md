# CMPS03 host

Last verified: 2026-08-31

CMPS03 currently has the standard Qwen 3.5 small/large pair on its direct
backends, but its authenticated port-8001 edge is not ready. This file records
that readiness boundary so the host is not accidentally treated as an approved
production or background inference server.

The shared implementation procedure is
[`../cmps01/README.md`](../cmps01/README.md); adapt it only after the edge issue
has an operational resolution.

## Host-specific inventory

| Component | Binding | Served model or role |
| --- | --- | --- |
| `eduai-vllm` | `127.0.0.1:18001` | `qwen3.5-2b-instruct` |
| `eduai-vllm-t3` | `127.0.0.1:18002` | `qwen3.5-9b-instruct` |
| LiteLLM | `127.0.0.1:18091` | Routes configured vLLM model IDs |
| nginx edge | host `:8001` | Authenticated public inference edge |
| Ollama | no listener observed on `11434` | Not currently available on this host |

The direct vLLM backends returned HTTP 200 during the 2026-08-31 audit. The
authenticated port-8001 edge returned HTTP 400 with
`no_db_connection` / `No connected db.`. The edge therefore does not currently
provide a passing fleet readiness signal.

## Readiness boundary

- Do not add CMPS03 to the approved production fleet.
- Do not assign CMPS03 a special background/heavy role.
- Do not treat direct backend success as an edge recovery.
- Keep the host's model IDs documented as observed, not as an approval to route
  application traffic.
- IT investigation remains the operational dependency; no resolution was
  available during the 2026-08-31 audit.

## Recovery verification

After the operational owner confirms a fix, run the authenticated check from an
approved server without printing the key:

```bash
curl -fsS --max-time 10 \
  -H "Authorization: Bearer \${VLLM_API_KEY}" \
  http://cmps03.ok.ubc.ca:8001/v1/models
```

Confirm that the response is HTTP 200 and includes the expected served model IDs.
Then test the consuming application and record the timestamp, commit/image,
model IDs, and approved role before changing fleet configuration.

