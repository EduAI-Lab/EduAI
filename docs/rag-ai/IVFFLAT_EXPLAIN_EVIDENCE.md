# Live EXPLAIN (ANALYZE, BUFFERS) evidence — #940

Captured against `pgvector/pgvector:pg16` (`eduai-db`, pgvector extension
`0.8.2`) with a seeded, skewed dataset: 20 "noise" courses × 2,500 chunks each
(50,000 rows, each course's embeddings clustered in a distinct direction) plus
one small target course with 6 chunks clustered in the query vector's
direction — the same "small course inside a large shared table" shape the
reviewer reproduced. The `material_embeddings_embedding_ivfflat_idx`
(`lists = 100`) was built **after** the data was seeded (see the
"index built before data exists" note in `EMBEDDINGS.md` and the migration
file). Full raw psql transcript available on request; the key excerpts below
are unedited plan output.

## 1. Row-count comparison (the core #940 correctness claim)

| Query | `RAG_IVFFLAT_PROBES` | Iterative scan | Rows returned |
| ----- | --- | --- | --- |
| ANN, fixed probes (pre-fix behavior) | 1 | off | **0** |
| ANN, iterative scan (the #940 fix) | 1 | `relaxed_order` + `max_probes=32768` | **6** |
| Exact search (`enable_indexscan/bitmapscan = off`) | n/a | n/a | **6** (ground truth) |

With `ivfflat.probes = 1` and no iterative scanning, the approximate scan
exhausts its one probed list before it reaches the target course's cluster
and returns **zero** rows — reproducing the reviewer's finding live. Enabling
`ivfflat.iterative_scan = relaxed_order` with `ivfflat.max_probes = 32768`
(pgvector ≥ 0.8.0 only) makes the same query return all **6** rows, matching
the exact-search ground truth exactly.

## 2. Planner confirms index usage in both cases

Pure-vector candidate query, `ivfflat.probes = 1`, **no** iterative scan
(reproduces the bug):

```
Limit (actual time=105.034..105.046 rows=0 loops=1)
  ->  ... Nested Loop ...
        ->  Index Scan using material_embeddings_embedding_ivfflat_idx on material_embeddings me
              (actual time=3.935..6.463 rows=600 loops=1)
              Order By: (embedding <=> $1)
Execution Time: 105.459 ms
```

Same query, same `ivfflat.probes = 1`, **with** `ivfflat.iterative_scan =
relaxed_order` + `ivfflat.max_probes = 32768` (the fix):

```
Limit (actual time=773.176..773.182 rows=6 loops=1)
  ->  ... Nested Loop ...
        ->  Index Scan using material_embeddings_embedding_ivfflat_idx on material_embeddings me
              (actual time=2.016..212.247 rows=23862 loops=1)
              Order By: (embedding <=> $1)
Execution Time: 773.277 ms
```

Both plans use `Index Scan using material_embeddings_embedding_ivfflat_idx`
— the planner picks the ANN index in both cases; iterative scanning changes
*how many lists get probed before giving up*, not whether the index is used.
The latency cost of iterative scanning here (~770ms vs ~105ms) reflects
probing far more of a 50k-row table than production's `RAG_IVFFLAT_PROBES`
default of 10 would in practice — this run deliberately used `probes = 1` to
stress-test the worst case from the reviewer's report.

Hybrid BM25 candidate query (same settings, `LIMIT` widened to the 4x
candidate pool) also uses the ANN index and returns all 6 rows in 2.86ms:

```
Limit (actual time=2.577..2.586 rows=6 loops=1)
  ->  ... Sort ... -> Nested Loop ...
Execution Time: 2.856 ms
```

Exact search (`enable_indexscan = off; enable_bitmapscan = off`), for
contrast — forces a full scan and confirms the ground-truth row count:

```
->  Seq Scan on material_embeddings me
      (actual time=0.837..724.991 rows=25006 loops=1)
      Filter: (('1'::double precision - (embedding <=> $3)) > '0.5'::double precision)
Execution Time: 755.527 ms
```

## 3. Reproduction / verification steps

```bash
# 1. Start the pgvector dev DB (docker-compose.dev.yml) and connect:
docker exec -it eduai-db psql -U postgres -d eduai_test

# 2. Seed skewed data + build the index AFTER seeding (see
#    docs/rag-ai/EMBEDDINGS.md "index built before data exists"):
#    - N noise courses with many chunks clustered in varying directions
#    - one small target course with a handful of chunks near the query vector
#    - CREATE INDEX ... USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

# 3. Run EXPLAIN (ANALYZE, BUFFERS) on the vector_candidates CTE from
#    findRelevantContent() (apps/core/app/lib/ai/embedding.ts), once with
#    only `SET LOCAL ivfflat.probes = 1`, and once also with
#    `SELECT set_config('ivfflat.iterative_scan', 'relaxed_order', true),
#             set_config('ivfflat.max_probes', '32768', true)`.
```

The same scenario is also covered by an automated integration test —
[`ivfflat-filtered-recall.integration.test.ts`](../../apps/core/app/tests/integration/ivfflat-filtered-recall.integration.test.ts)
— which seeds a smaller but still-skewed (4,000:4) dataset and asserts
`findRelevantContent()` itself (not just the raw SQL) returns all 4
target-course rows with `RAG_IVFFLAT_PROBES=1`.
