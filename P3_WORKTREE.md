# Learned router (P3) worktree

**Branch:** `feat/learned-router-p3`  
**Base:** `feat/research-routing-vllm`  
**Path:** `EduAICoreLearning-learned-router-p3`

Prototype **P3** (kNN + hybrid) without blocking the main research branch. Fine-tune exemplars and retrain here; merge when P3 beats P1 on held-out test.

## What is already in code

| Piece | Path |
|-------|------|
| kNN predictor | `apps/core/app/lib/ai/routing/knn.ts` |
| Hybrid router | `apps/core/app/lib/ai/routing/router.ts` (`ROUTER_MODE=hybrid`) |
| Seed exemplars | `apps/core/data/routing-knn-exemplars.json` |

## P3 scripts (this worktree)

```bash
cd apps/core
set -a && source .env.research && set +a   # or .env with OLLAMA / embed keys

# 1) Build exemplars from oracle labels (dev split)
npm run research:build-knn-exemplars

# 2) Offline eval vs labels (use leave-one-out for honest dev scores)
RESEARCH_KNN_LEAVE_ONE_OUT=1 npm run research:eval-knn

# 3) Live Auto with hybrid router (dev server)
ROUTER_MODE=hybrid npm run dev
```

## Environment

```bash
ROUTER_MODE=rules    # P1 (default)
ROUTER_MODE=knn      # P3 pure kNN (after rule bypass for images)
ROUTER_MODE=hybrid   # P3 recommended: rules when kNN confidence low

ROUTING_KNN_K=5
ROUTING_KNN_MIN_SIM=0.55
ROUTING_KNN_EXEMPLARS_PATH=./data/routing-knn-exemplars.json
```

## Workflow

1. **v0** — exemplars from `labels.v1.jsonl` (dev); offline eval with leave-one-out  
2. **v1** — human-corrected labels + more prompts; rebuild exemplars  
3. **v2** — optional RouteLLM trainer (Python) exporting tier classifier; same guardrails  
4. **Merge** — when hybrid beats P1 on **test** split via `research:run-policy` with `ROUTER_MODE=hybrid` on server  

## Policy comparison note

`run-policy-comparison.mjs` still sends `model=auto`. For live P3 runs, set `ROUTER_MODE=hybrid` (or `knn`) in `apps/core/.env` on the server before `RESEARCH_POLICY=P1` runs — telemetry will show `routerVersion: v2-hybrid` and `pickSource: knn|rules`.

## Do not

- Train on **test** split exemplars (leakage)  
- Claim P3 wins before held-out test + human label review  
- Replace rule guardrails (tools, images, local-only) with kNN alone  

See `docs/research/RESEARCH_CONTEXT.md` → *Third-party routing libraries*.
