# EduAI inference fleet

Last verified: 2026-08-31

This directory documents the CMPS fleet as a set of related hosts. The fleet is
not homogeneous, so host-specific model inventory and readiness are kept separate
from the shared proxy/deployment contract.

## Shared contract

EduAI reaches an approved inference host through one authenticated HTTP edge:

| Layer | Port/binding | Responsibility |
| --- | --- | --- |
| nginx edge | host `:8001` | Publicly reachable fleet API boundary |
| LiteLLM | `127.0.0.1:18091` | Routes model IDs to local vLLM backends |
| vLLM backends | `127.0.0.1:18001`, `:18002`, etc. | One loaded model per backend |
| Embeddings | host-specific; CMPS01 currently `127.0.0.1:18003` | Local embedding model where installed |
| Energy sidecar | host-specific; CMPS01 currently `127.0.0.1:9100` | Research energy measurements |

Raw vLLM, LiteLLM, embedding, and energy ports must not be opened as public
alternatives to port 8001. The bearer key belongs only in server-side environment
files. Never place it in documentation, browser URLs, client bundles, or command
output.

For server-related escalation, use the contacts in the canonical
[`deployment guide`](../../docs/DEPLOYMENT.md#operational-contacts). Do not
duplicate contact details in individual host runbooks.

The implementation procedure for the nginx/LiteLLM/vLLM stack is currently
[`../cmps01/README.md`](../cmps01/README.md). It is written for CMPS01's
repository-managed deployment and should be reused for other hosts only after
reviewing their GPU, model, port, and proxy differences.

## Model tiers

The standard application model IDs are:

- small tier: `qwen3.5-2b-instruct`;
- large tier: `qwen3.5-9b-instruct`, only where the host advertises it;
- XL tier - : `qwen3.8-27b`, use for admin chat, instructors, 

`qwen2.5-32b-instruct` on CMPS02 is a separate Assist Auto capability. It is not
the standard large tier and must not be substituted for `qwen3.5-9b-instruct` in
the general model catalog.

## Verified host snapshot

The following results came from read-only SSH and authenticated port-8001 checks
on 2026-08-31:

| Host | Direct models observed | Authenticated edge | Fleet disposition |
| --- | --- | --- | --- |
| [CMPS01](./cmps01.md) | Qwen 3.5 2B, Qwen 3.5 9B, `mxbai-embed-large` | HTTP 200 | Approved candidate, subject to security checks |
| [CMPS02](./cmps02.md) | Qwen 3.5 2B, Qwen 2.5 32B | HTTP 200 | Assist Auto capability; verify role before use |
| [CMPS03](./cmps03.md) | Qwen 3.5 2B, Qwen 3.5 9B | HTTP 400 `no_db_connection` | Not approved until edge readiness is restored |

A direct backend returning HTTP 200 does not clear an edge-proxy failure. The
CMPS03 result remains the last recorded readiness issue reported to IT; no update
was available during the audit. Do not add CMPS03 to an approved production fleet
or assign it a special background/heavy role until the authenticated edge succeeds
and its operational owner confirms the host.

## Fleet validation

Run the edge check from an approved server with the existing key, without
printing the key:

```bash
for host in cmps01.ok.ubc.ca cmps02.ok.ubc.ca cmps03.ok.ubc.ca; do
  curl -fsS --max-time 10 \
    -H "Authorization: Bearer \${VLLM_API_KEY}" \
    "http://\${host}:8001/v1/models"
done
```

Use direct backend checks only to distinguish a vLLM failure from an edge failure:

```bash
curl -fsS http://127.0.0.1:18001/v1/models
curl -fsS http://127.0.0.1:18002/v1/models
```

A host is ready only when the authenticated edge returns the expected model IDs,
the required application can reach it, and the owner has accepted its operational
role. Re-run this validation after model replacement, proxy changes, firewall
changes, or a server reboot.
