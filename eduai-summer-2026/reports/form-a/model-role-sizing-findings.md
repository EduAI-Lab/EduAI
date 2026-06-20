# Model role sizing — Student / Teacher / Dean (7B, 32B, 51B)

**Date:** 2026-06-19  
**Branch:** `development`  
**Environment:** `https://dev.eduai.ok.ubc.ca` → cmps01 vLLM (`VLLM_BASE_URL`)  
**Scenarios:** Form A S1, S2-T1 ([`form-a-scenario-test-sheet.md`](../../../docs/literature/form-a-scenario-test-sheet.md))  
**Pass criteria:** `**Top summary**` + `**Next?**` in tail + ≤250 words ([`adhd-metrics.ts`](../../../apps/core/app/lib/ai/adhd-metrics.ts))

---

## 1. Role mapping

| Research role | What it does | Code |
| ------------- | ------------ | ---- |
| **AI Student** | Generates the first draft reply | `streamText` in [`chat.ts`](../../../apps/core/app/routes/api/chat.ts) |
| **AI Teacher** | ADHD-aware restructuring (summary-first, step ladder, `Next?`) | `ADHD_ASSIST_POLICY_BLOCK` when `adhdAssist: true` ([`adhd-assist.ts`](../../../apps/core/app/lib/ai/adhd-assist.ts)) |
| **AI Dean** | Final structural / cognitive review before delivery | `auditAndMaybeRewrite()` ([`adhd-oversight.ts`](../../../apps/core/app/lib/ai/adhd-oversight.ts)) |

**Note:** Student and Dean currently share the **same** model id. A separate Dean model is a **recommendation**, not shipped config.

---

## 2. Models on Saad's stack (cmps01)

| Label | EduAI model id | Backend | Active on dev | Tools |
| ----- | -------------- | ------- | ------------- | ----- |
| **7B** | `vllm:qwen2.5-7b-instruct` | GPU 0 via LiteLLM `:8001` | Yes | No → hybrid RAG (faster) |
| **32B** | `vllm:qwen2.5-32b-instruct` | GPU 1, 32B AWQ | Yes | Yes → full tool/RAG path |
| **51B*** | `ollama:gpt-oss:120b` | Ollama on cmps01 | No (inactive) | — |
| ~31B | `ollama:gemma4:31b` | Ollama | No (inactive) | — |

\*There is **no** dense 51B checkpoint on cmps01. The third tier is **`gpt-oss:120b`** (116.8B total MoE, **5.1B active params/token**). If "51B" meant **5.1B active**, that is gpt-oss, not a separate Qwen 51B.

Refs: [`infra/cmps01/litellm-config.yaml`](../../../infra/cmps01/litellm-config.yaml), [`docs/rag-ai/VLLM.md`](../../../docs/rag-ai/VLLM.md).

---

## 3. Live results (partial)

**Session:** 2026-06-19, dev server, non-streaming `/api/chat`.  
**Limitation:** 4 of 16 cells completed; dev then returned HTTP 500 (`Cannot find module '@eduai/ui'`). 32B and multi-turn S2/S3 not captured.

| Model | Scenario | Assist | Total | Words | Top summary | Next? | **PASS** |
| ----- | -------- | ------ | ----- | ----- | ----------- | ----- | -------- |
| 7B | S1 (gradient descent) | OFF | 2.1 s | 97 | ✗ | ✗ | FAIL |
| 7B | S1 | ON | 3.4 s | 145 | ✓ | ✓ | **PASS** |
| 7B | S2-T1 (dish steps) | OFF | 4.0 s | 178 | ✗ | ✗ | FAIL |
| 7B | S2-T1 | ON | 4.5 s | 84 | ✗ | ✗ | FAIL |

**Takeaways**

- Baseline (Assist OFF) never passes the structural rubric — expected.
- **7B + Assist + Dean** fixed S1 but **failed S2-T1** (step ladder) — policy + oversight alone were not enough on 7B for that turn.
- Oversight added **~1.3 s** on S1 (2.1 → 3.4 s), consistent with Phase 3 estimates (+1–3 s).

---

## 4. Infra benchmarks (same stack, repo)

From [`VLLM.md`](../../../docs/rag-ai/VLLM.md) (vLLM Session S1, dev → cmps01):

| Probe | 7B direct | 7B via EduAI | Ollama 7B (5 parallel) |
| ----- | --------- | ------------ | ---------------------- |
| Warm short prompt | ~57 ms median | ~211 ms median | ~2.9 s |

From [`FINDINGS.md`](../../../docs/rag-ai/latency/eduai-summer-2026/FINDINGS.md):

- Ollama **31B / 120B-class** models: **40–50 s** end-to-end — not suitable for interactive Student/Teacher until vLLM migration.
- 7B tool path via EduAI: **~6.2 s** median total vs **~1.3 s** bare Ollama (Session 8).

---

## 5. Dean role — unit tests (local)

`cd apps/core && npx vitest run app/tests/unit/adhd-oversight.test.ts app/tests/unit/chat-oversight.route.test.ts` → **37/37 PASS**.

Oversight is a narrow formatting task; many drafts are fixed **deterministically** without a second LLM call. Supports using a **smaller model for Dean** than for Student/Teacher.

---

## 6. Recommendations

| Role | Recommended model | Rationale |
| ---- | ----------------- | --------- |
| **AI Student** | **32B** when tools, RAG, or multi-step answers needed; **7B** for short course-agnostic Q&A | 32B has tool calling; 7B faster but failed step-ladder on S2-T1 |
| **AI Teacher** | **32B** (same as Student today) | Stronger instruction-following for policy (caps, ladder, single-topic) |
| **AI Dean** | **7B** (proposed split) | Narrow rewrite; deterministic pass often sufficient |

**Avoid for live chat today:** `gpt-oss:120b`, `gemma4:31b` on Ollama — inactive on dev; documented 40–50 s latency class.

**Efficiency summary:** Use **32B once** for understanding + structured draft; use **7B or deterministic rules** for Dean.

---

## 7. Gaps — complete before final presentation

1. Fix dev server (`@eduai/ui`), then re-run:

```bash
cd apps/core
EDUAI_BASE_URL=https://dev.eduai.ok.ubc.ca \
EDUAI_COOKIE='<session cookie>' \
EDUAI_MODEL=vllm:qwen2.5-32b-instruct \
EDUAI_API_KEYS_JSON='{"vllm":{"isEnabled":true}}' \
npm run eval:adhd -- --only S1,S2,S3 --mode both
```

Repeat for `vllm:qwen2.5-7b-instruct`.

2. Add **51B / gpt-oss** column only after Saad deploys it on vLLM or activates Ollama with acceptable latency.

3. Optional engineering follow-up: env var **`ADHD_OVERSIGHT_MODEL`** so Dean ≠ Student.

---

## 8. Slide bullets

- Student–Teacher–Dean maps to EduAI chat + ADHD policy + Phase 3 oversight (SocraticLM-inspired).
- **7B:** fastest vLLM tier; good **Dean** candidate; weak on step-ladder **Teacher** compliance alone.
- **32B:** only active large tier; use for **Student + Teacher** when tools or structure matter.
- **51B / gpt-oss:120b:** not in production path; 5.1B-active MoE if that is what "51B" meant.
- Participant data (n=1): Assist + oversight preferred over baseline on scanability and workload ([`three-condition-sus-tlx-comparison.md`](./three-condition-sus-tlx-comparison.md)).
