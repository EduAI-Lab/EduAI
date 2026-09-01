# Potential HELPME-informed RAG and AI upgrades

This page records potential upgrades for EduAI informed by work in the HELPME
platform, which is the platform being referenced here. These ideas are not part
of the current EduAI runtime contract, and this page does not claim that any
listed capability is already available in either platform. A proposal remains
here until it has an owner, implementation, tests, configuration documentation,
and an operational check.

## Potential upgrades

### Post-MVP candidates from the RAG/AI project-board filter

The [EduAI-Lab project board's `Backlog Post MVP` section](https://github.com/orgs/EduAI-Lab/projects/8/views/1)
contains the following 11 items when filtered to the `RAG/AI` label. They are
recorded here as potential EduAI upgrades, not as a delivery plan or evidence
that the features are currently shipped. The board can contain historical
items, so implementation status must be checked against the code and current
tests before any proposal is revived.

The board candidates consolidate with the proposals below as follows:

- **Retrieval and conversation context:** [#799 prior-question cache](https://github.com/EduAI-Lab/EduAI/issues/799)
  is covered by “Evaluate prior-question retrieval and caching” below. [#1319
  start a new chat when the user diverges](https://github.com/EduAI-Lab/EduAI/issues/1319)
  could extend that work with explicit topic/session boundaries and safe
  context rollover.
- **Course and extension integration:** [#425 course data integration](https://github.com/EduAI-Lab/EduAI/issues/425)
  could become a more complete lifecycle contract for source provenance,
  change detection, reconciliation, and deletion. [#232 stream AI responses
  to Question Maker and AI Tutor](https://github.com/EduAI-Lab/EduAI/issues/232)
  and [#661 shared context agents](https://github.com/EduAI-Lab/EduAI/issues/661)
  are potential multi-consumer and multi-agent context interfaces; they need
  authorization, cancellation, privacy, and failure-boundary designs before
  implementation.
- **AI capabilities and training support:** [#1321 wire a chart library into
  the AI tool-calling harness](https://github.com/EduAI-Lab/EduAI/issues/1321)
  could add a validated structured-visualization tool path. [#846 structure
  Question Maker exams for fine-tuned model training](https://github.com/EduAI-Lab/EduAI/issues/846)
  could add dataset provenance, de-identification, evaluation gates, and
  retention rules; it should not be treated as a current training pipeline.
- **Quality and analytics:** [#495 AI quality evaluation](https://github.com/EduAI-Lab/EduAI/issues/495)
  belongs with the production-aligned evaluation work below. [#728 chat
  analytics](https://github.com/EduAI-Lab/EduAI/issues/728) and [#1608 instructor
  analytics](https://github.com/EduAI-Lab/EduAI/issues/1608) can be one role-aware
  analytics proposal covering quality signals, misconceptions, retrieval
  health, and privacy-preserving instructor views.
- **Fleet and lifecycle operations:** [#1525 sleep AI models](https://github.com/EduAI-Lab/EduAI/issues/1525)
  could add explicit idle-model lifecycle policies, warm-up behavior, resource
  accounting, and user-visible degradation semantics. It should complement
  the current routing and health controls rather than silently changing them.

### Make the evaluation path match production

The current `apps/core/scripts/eval-rag-seed.ts` forces the legacy 3072-dimensional
embedding path while the live schema is `vector(1024)`. A future upgrade should
make evaluation select the same effective provider, model, dimension, chunking,
visibility filters, and threshold behavior as production, or clearly isolate a
legacy evaluator with its own schema.

The ingestion fixture script also contains a slide-marker assertion without a
matching committed slide fixture. Add a real slide fixture or remove the
assertion, then make the test output an unambiguous pass/fail result.

### Evaluate prior-question retrieval and caching

HELPME's prior-question/context work is a useful reference for a possible EduAI
upgrade, not an existing implementation. Before adopting it, define the scope:

- what prior user/assistant content is eligible for retrieval;
- how course and user authorization are applied;
- whether summaries, embeddings, or exact-message caches are used;
- invalidation behavior after course-material changes or chat deletion;
- privacy, retention, and prompt-injection boundaries; and
- latency and token-budget acceptance criteria.

Do not add a prior-question cache by copying an old design note without a current
data model, authorization tests, and a measured invalidation strategy.

### Improve retrieval quality deliberately

Potential experiments include query rewriting, HyDE-style expansion, lexical /
semantic blending, reranking, adaptive top-k, and section-aware metadata. Each
experiment should be evaluated against a versioned question/answer corpus and
the current fail-closed behavior. A quality improvement must not bypass student
visibility filters or cause unsupported answers when retrieval is empty.

### Improve corpus lifecycle and observability

Potential operational upgrades include:

- a first-class corpus/evaluation dashboard for embedding provider/model
  snapshots, stale courses, failed materials, and re-embed progress;
- explicit index health and recall checks after pgvector/index changes;
- a repair path for partially processed or lease-expired materials;
- structured tracing that separates embedding, database, provider, tool, and
  fleet time; and
- repeatable multi-user load tests instead of the current single-session stress
  harness.

These should build on the existing lease fencing, bounded concurrency, health
metadata, and response headers rather than replacing them with undocumented
operator scripts.

### Normalize fleet configuration and smoke tests

Runtime fleet routing prefers `fleet.config.json`, while the current smoke
scripts still read legacy `VLLM_FLEET_*` variables. A future upgrade should make
the smoke tests exercise the same configuration loader as production and verify
interactive/background pool selection, live model discovery, affinity, host
ejection, and one alternate-host retry.

### Clarify queue and overflow policy

The chat enqueue path and worker contract exist behind a guarded, dormant
pre-MVP configuration. A potential upgrade is to define when work should be
queued, how client status polling behaves, how interactive work is prioritized,
and how Bedrock overflow is cost/rate limited. Do not describe queue enqueueing
as the default chat path until the feature is enabled and operated in a real
deployment.

## Definition of done for a future upgrade

Before moving a proposal into current documentation:

1. implementation and migration/configuration changes are merged;
2. unit and integration tests cover authorization, failure, and compatibility;
3. a controlled evaluation measures quality and latency against a named baseline;
4. deployment and rollback steps are documented;
5. secrets and data-retention implications are reviewed; and
6. this folder's current-contract docs are updated to match the shipped code.

## Related current references

- Current chat and RAG behavior: [`CHAT_RAG_PIPELINE.md`](./CHAT_RAG_PIPELINE.md)
- Current embeddings and retrieval: [`EMBEDDINGS.md`](./EMBEDDINGS.md)
- Current measurement harnesses: [`PERFORMANCE.md`](./PERFORMANCE.md)
- Current testing limitations: [`TESTING.md`](./TESTING.md)
