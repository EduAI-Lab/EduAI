# Model role sizing — Student / Teacher / Dean (7B, 32B, 51B)

**Original session:** 2026-06-19  
**Last updated:** 2026-06-21 (post–Approach A v1, PR [#714](https://github.com/EduAI-Lab/EduAI/pull/714))  
**Branch:** `feat/adhd-feedback-implementation` → `development`  
**Environment:** `https://dev.eduai.ok.ubc.ca` → cmps01 vLLM (`VLLM_BASE_URL`)  
**Scenarios:** Form A S1, S2-T1 ([`form-a-scenario-test-sheet.md`](../../../docs/literature/form-a-scenario-test-sheet.md))

**Pass criteria (tutoring turns):** `**Top summary**` + `**Next?**` in tail + ≤250 words ([`adhd-metrics.ts`](../../../apps/core/app/lib/ai/adhd-metrics.ts))

**Pass criteria (profile-conditional, v1+):** [`isProfileStructuralPass()`](../../../apps/core/app/lib/ai/adhd-metrics.ts) — redirect/greeting/confirmation do **not** require Top summary ([`adhd-turn-profile.ts`](../../../apps/core/app/lib/ai/adhd-turn-profile.ts)).

---

## 1. Role mapping

| Research role | What it does | Code |
| ------------- | ------------ | ---- |
| **Router** *(v1)* | Classifies user turn **before** generation; sets word cap and whether Dean runs | `resolveAdhdTurnProfile()` + `getProfileRequirements()` in [`adhd-turn-profile.ts`](../../../apps/core/app/lib/ai/adhd-turn-profile.ts); wired in [`chat.ts`](../../../apps/core/app/routes/api/chat.ts) |
| **AI Student** | Generates the first draft reply | `streamText` in [`chat.ts`](../../../apps/core/app/routes/api/chat.ts) |
| **AI Teacher** | ADHD-aware policy injected into system prompt (scoped by profile) | `composeSystemPrompt(..., { profile })` + `resolveAdhdAssistPolicyBlock()` in [`adhd-assist.ts`](../../../apps/core/app/lib/ai/adhd-assist.ts) |
| **AI Dean** | Profile-conditional structural review before delivery | `auditAndMaybeRewrite({ profile })` in [`adhd-oversight.ts`](../../../apps/core/app/lib/ai/adhd-oversight.ts) |

**Pipeline (v1 — Approach A):**

```
User message → Router (rules) → Teacher policy slice → Student draft → Dean (if runDean)
```

**Model note:** Student and Dean still share the **same** model id (`aiModel` passed to both). Separate Dean model is **recommended** but **not shipped** — tracked as v2 ([#716](https://github.com/EduAI-Lab/EduAI/issues/716)).

**Dean skip (v1 latency win, no model change):** `greeting`, `confirmation`, and `meta` profiles set `runDean: false` — no second pass at all.

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

## 3. Live results (partial — pre-v1, 2026-06-19)

**Session:** 2026-06-19, dev server, non-streaming `/api/chat`.  
**Limitation:** 4 of 16 cells completed; dev then returned HTTP 500 (`Cannot find module '@eduai/ui'`). 32B and multi-turn S2/S3 not captured. **Blind structure** (Top summary on every turn) — before profile routing.

| Model | Scenario | Assist | Total | Words | Top summary | Next? | **PASS** |
| ----- | -------- | ------ | ----- | ----- | ----------- | ----- | -------- |
| 7B | S1 (gradient descent) | OFF | 2.1 s | 97 | ✗ | ✗ | FAIL |
| 7B | S1 | ON | 3.4 s | 145 | ✓ | ✓ | **PASS** |
| 7B | S2-T1 (dish steps) | OFF | 4.0 s | 178 | ✗ | ✗ | FAIL |
| 7B | S2-T1 | ON | 4.5 s | 84 | ✗ | ✗ | FAIL |

**Takeaways (still valid for model sizing)**

- Baseline (Assist OFF) never passes the global structural rubric — expected.
- **7B + Assist + Dean** fixed S1 but **failed S2-T1** (step ladder) — policy + oversight alone were not enough on 7B for that turn. S2-T1 maps to `full_tutoring` profile → still requires 32B Student recommendation.
- Oversight added **~1.3 s** on S1 (2.1 → 3.4 s), consistent with Phase 3 estimates (+1–3 s).

**Post-v1 expectation:** greeting/redirect turns skip Dean entirely; re-run matrix after [#714](https://github.com/EduAI-Lab/EduAI/pull/714) merge to measure latency stratified by `responseProfile`.

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

```bash
cd apps/core && npx vitest run \
  app/tests/unit/adhd-turn-profile.test.ts \
  app/tests/unit/adhd-metrics.test.ts \
  app/tests/unit/adhd-assist.test.ts \
  app/tests/unit/adhd-oversight.test.ts \
  app/tests/unit/chat-oversight.route.test.ts
```

→ **81/81 PASS** (as of 2026-06-21, includes profile routing).

Oversight is a narrow formatting task; many drafts are fixed **deterministically** without a second LLM call. v1 adds profile-specific pass (e.g. S2.t2 redirect passes **without** Top summary). Supports using a **smaller model for Dean** than for Student/Teacher.

---

## 6. Recommendations

| Role | Recommended model | Shipped? | Rationale |
| ---- | ----------------- | -------- | --------- |
| **Router** | Rules only (no LLM) | **Yes (v1)** | Reproducible; optional 7B classifier deferred to v2 [#718](https://github.com/EduAI-Lab/EduAI/issues/718) |
| **AI Student** | **32B** when tools, RAG, or multi-step answers needed; **7B** for short course-agnostic Q&A | **No (v2)** [#717](https://github.com/EduAI-Lab/EduAI/issues/717) | 32B has tool calling; 7B faster but failed step-ladder on S2-T1 |
| **AI Teacher** | **32B** (same model as Student — policy is prompt slice, not a separate call) | N/A | Stronger instruction-following for caps, ladder, single-topic |
| **AI Dean** | **7B** when LLM rewrite needed; deterministic rules often sufficient | **No (v2)** [#716](https://github.com/EduAI-Lab/EduAI/issues/716) | Narrow rewrite; skip entirely on greeting/confirmation/meta (v1) |

**Profile → structure (v1, same model today):**

| Profile | Dean runs? | Top summary required? |
| ------- | ---------- | --------------------- |
| `full_tutoring`, `brief_clarification` | yes if fail | yes |
| `redirect` | yes if fail | no (§5 drift template) |
| `greeting`, `confirmation`, `meta` | **no** | no |

**Avoid for live chat today:** `gpt-oss:120b`, `gemma4:31b` on Ollama — inactive on dev; documented 40–50 s latency class.

**Efficiency summary:** Use **32B once** for understanding + structured draft on tutoring turns; use **7B or deterministic rules** for Dean; skip Dean on low-structure profiles (v1).

---

## 7. Gaps — complete before final presentation

1. Merge [#714](https://github.com/EduAI-Lab/EduAI/pull/714), fix dev server (`@eduai/ui` if needed), then re-run with **profile-conditional** scoring:

```bash
cd apps/core
EDUAI_BASE_URL=https://dev.eduai.ok.ubc.ca \
EDUAI_COOKIE='<session cookie>' \
EDUAI_MODEL=vllm:qwen2.5-32b-instruct \
EDUAI_API_KEYS_JSON='{"vllm":{"isEnabled":true}}' \
npm run eval:adhd -- --only S1,S2,S3,S5 --mode all-three
```

Repeat for `vllm:qwen2.5-7b-instruct`. Compare `responseProfile` and `profileStructuralPass` in telemetry.

2. Add **51B / gpt-oss** column only after Saad deploys it on vLLM or activates Ollama with acceptable latency.

3. **v2 — model split** (parent epic [#715](https://github.com/EduAI-Lab/EduAI/issues/715)):
   - [#716](https://github.com/EduAI-Lab/EduAI/issues/716) — `ADHD_OVERSIGHT_MODEL` env so Dean ≠ Student
   - [#717](https://github.com/EduAI-Lab/EduAI/issues/717) — `ModelPlan`: profile → Student 7B/32B
   - [#718](https://github.com/EduAI-Lab/EduAI/issues/718) — optional LLM ambiguous classifier
   - [#719](https://github.com/EduAI-Lab/EduAI/issues/719) — latency validation + Form A appendix

**Research note:** v1 changed **structure IV** (profile-conditional). v2 changes **model IV** — pre-register separately before claiming latency wins in IURA.

---

## 8. Slide bullets

- **Router → Teacher → Student → Dean** (Approach A); SocraticLM-inspired classify-then-generate-then-verify.
- **v1 shipped:** rules-based turn profiles; Dean skipped on greeting/confirmation; redirect without forced Top summary.
- **7B:** fastest vLLM tier; good **Dean** candidate; **do not** use for `full_tutoring` / step ladders (S2-T1 failed).
- **32B:** only active large tier; use for **Student + Teacher** when tools or multi-step structure matter.
- **51B / gpt-oss:120b:** not in production path; 5.1B-active MoE if that is what "51B" meant.
- **v2 next:** split Dean to 7B; route short profiles to 7B Student ([#715](https://github.com/EduAI-Lab/EduAI/issues/715)).
- Participant data (n=1): Assist + oversight preferred over baseline on scanability and workload ([`three-condition-sus-tlx-comparison.md`](./three-condition-sus-tlx-comparison.md)).

---

## 9. v1 changelog (2026-06-21)

| Before (pre-v1) | After (PR #714) |
| --------------- | --------------- |
| One `ADHD_ASSIST_POLICY_BLOCK` on every assist turn | Profile-scoped policy slices in `adhd-assist.ts` |
| Dean enforced global Top summary + Next? | `isProfileStructuralPass()` per profile |
| Same word cap heuristic only | Router sets cap + `runDean` per profile |
| Eval `TURN_SHAPE` ≠ runtime | Eval uses `resolveAdhdTurnProfile()` for assist arms |
| Telemetry: global `structuralPass` only | + `responseProfile`, `profileStructuralPass` |

**Issues closed by v1:** [#712](https://github.com/EduAI-Lab/EduAI/issues/712), [#713](https://github.com/EduAI-Lab/EduAI/issues/713).
