# Shared development deployment and RAG checks

The shared UBCO development host is `s378`, served at
`dev.eduai.ok.ubc.ca`. It is a deployment target, not a development workstation:
Core runs as a Node service and the extension frontends are built static assets.
The deployment source of truth is [`infra/s378/GO-LIVE.md`](../../infra/s378/GO-LIVE.md)
and the scripts under [`infra/s378/`](../../infra/s378/).

## Services

| Public host | Runtime |
| --- | --- |
| `https://dev.eduai.ok.ubc.ca` | Core SSR on port 3000 |
| `https://dev.aitutor.eduai.ok.ubc.ca` | Apache static client; `/api/` proxies to port 4000 |
| `https://dev.questionmaker.eduai.ok.ubc.ca` | Apache static client; `/api/` proxies to port 8000 |

The application services are managed as system units: `eduai-core.service`,
`eduai-cron-worker.service`, `eduai-aitutor-server.service`, and
`eduai-qm-backend.service`, grouped by `eduai-dev.target`. They are not
`systemctl --user` units. A restart reloads server-side environment values; a
`VITE_` value requires a rebuild because it is compiled into the frontend.

## Rebuild and restart

Use the repository deployment command on s378:

```bash
git pull
bash infra/s378/go-live-build.sh
```

For a branch switch that needs dependency installation:

```bash
bash infra/s378/go-live-build.sh --install
```

To build one application only, use `--only core`, `--only aitutor`, or
`--only qm` (the extension names are also accepted as documented by the script).
The full command handles environment generation, Prisma generation/migrations,
extension setup, builds, and service restarts in the required order.

Do not edit a legacy `~/dev-vhosts` copy. Apache vhosts, systemd units, and
deployment behavior are tracked under `infra/s378/`.

## RAG environment on the dev host

Core's `.env` is host-local and must never be committed. Use
[`apps/core/.env.example`](../../apps/core/.env.example) for variable names.
For RAG, verify the deployment intentionally chooses one of:

- local embeddings through the configured CMPS/Ollama endpoint;
- cloud 1024-dimensional embeddings through OpenRouter/OpenAI;
- a deliberately isolated legacy 3072-dimensional setup.

The shared current schema is `vector(1024)`. Before changing provider/model or
dimension, read [`EMBEDDINGS.md`](./EMBEDDINGS.md) and coordinate migration and
re-embedding; do not experiment against the shared corpus.

For local chat, `VLLM_BASE_URL` points Core at the protected vLLM edge. Fleet
variables or a host-local `fleet.config.json` control multi-host routing. See
[`VLLM.md`](./VLLM.md) and [`MODEL_ROUTING.md`](./MODEL_ROUTING.md).

## Safe operational checks

```bash
systemctl status eduai-dev.target
systemctl is-active eduai-core eduai-cron-worker eduai-aitutor-server eduai-qm-backend
journalctl -u eduai-core -n 100 --no-pager
```

Confirm that the public extension pages serve hashed assets, not Vite source or
`@vite/client`:

```bash
curl -sk https://dev.questionmaker.eduai.ok.ubc.ca/ | grep -o 'src="[^"]*"'
curl -sk https://dev.aitutor.eduai.ok.ubc.ca/ | grep -c '@vite/client'
```

The first should show `/assets/...` and the second should be `0`.

## RAG smoke checks

Run provider checks from the Core checkout on the host or an approved machine:

```bash
cd apps/core
npm run test:embedding
npm run vllm:smoke
npm run fleet:smoke
```

For a database-backed fixture run, use
`npx tsx scripts/seed-rag-ingestion-fixtures.ts` only against an approved test
course/database. For authenticated end-to-end RAG and fleet measurement, use
[`PERFORMANCE.md`](./PERFORMANCE.md); it requires explicit fixture mutation
guards and cleanup.

## Shared service key

Core, AI Tutor, and Question Maker use the same `EDUAI_API_KEY` for server-to-
server operations. `infra/s378/go-live-env.sh` copies the Core value to the
extension server environments. Generate and rotate it outside the repository;
never print it in a support request or commit it.

If extension APIs fail with service-key errors, check key presence and equality
without printing values, then rebuild/restart as appropriate. Interactive chat
normally uses the shared session cookie; the service key remains required for
server-to-server sync and related operations.

## Troubleshooting order

1. Check the public host and service status.
2. Check Core logs for sanitized provider, queue, or RAG errors.
3. Check the effective model and course access in the request.
4. Check `X-RAG-Latency-Ms`, `X-Admission-Wait-Ms`, and `X-Fleet-Server` to
   distinguish retrieval, admission, and inference delay.
5. Check embedding dimension/provider alignment before re-embedding anything.

Do not infer a RAG failure from a slow response alone, and do not treat an empty
retrieval result as proof that the embedding provider failed.
