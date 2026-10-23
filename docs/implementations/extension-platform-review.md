# Extension platform review: decisions and evidence

**Date:** 2026-10-22. **Baseline:** `8741d6d70`, refreshed `origin/development`.

**Design:** [Extension platform proposal](../superpowers/specs/2026-10-22-extension-platform-design.md).

This continues the interrupted Claude review. Three independent read-only reviewers checked authentication/security, architecture/scaling and student onboarding; the primary reviewer checked source and synthesized their positions. Reviewers received competing positions for rebuttal, with direct peer challenges. The old agents were not resumed and missing replies were not invented.

## Resolution of seven disputes

| Dispute | Decision and reason |
|---|---|
| SDK now/later | Thin SDK now: template needs one auth/transport contract. Defer domain synchronization and existing-app migration; their clients are not identical. |
| Key design | Scoped, expiring extension credentials in operator-owned config; distinct central principal. Preserve personal grants and legacy callers. Reject full service-key power and the assumption that passwordless human accounts cannot log in. |
| Registry reach | Cover a complete supported profile: launcher, bug identity, lifecycle, local/CI/build and operational registration. Folder-plus-entry is conditional on a generated fourth extension passing those paths. |
| Branch/fork | Authorized branches with early PRs are convenient; forks remain valid. Enforced upstream review is the protection; CODEOWNERS cannot govern independently deployed forks. |
| First-deploy gates | Scope/actor enforcement, secret isolation, redaction, controlled reviewed releases, backup/lifecycle checks and separate callback keys. Independent/untrusted deployment requires federation first. |
| Promotions | Students may author Core promotion PRs; maintainers review/run privileged migrations. Fixtures unblock independent work, while real integration gates dependent release paths. |
| Non-Node kit | HTTP contract/checks now; adapter when an actual project needs it. Do not rewrite working domain logic merely to use Node/Prisma. |

Reviewers converged on these recommendations. Professor/team choices remain: port location, pilot stack and deployment ownership.

**Later decision (2026-10-22):** course deletion uses a per-extension callback secret, a Core re-check before archiving, and the template's nightly reconcile job instead of the proposed outbox. That gets the same outcome with no new Core subsystem.

## Source-verified corrections

| Earlier assumption | Correction and evidence |
|---|---|
| #2040 still queued | Merge `4385dc2fb` is an ancestor of refreshed development `8741d6d70` and main `b5de3921d`. |
| Personal key replaces Bearer through env | Personal keys use `x-api-key`: [auth config](../../apps/core/app/lib/auth/server.ts), [guards](../../apps/core/app/lib/auth/guards.server.ts). [Service verification](../../apps/core/app/lib/auth/service-key.server.ts) checks separate env Bearer credentials. |
| Change only `requireServiceKey` | [Root](../../apps/core/app/root.tsx) and [session validation](../../apps/core/app/routes/api/sessions.validate.ts) also call the synchronous predicate. Cookie branches can skip service guards. |
| Cookie plus key always preserves user permissions | [Question reads](../../apps/core/app/routes/api/questions.ts) and [bank routes](../../apps/core/app/routes/api/courses.banks.$.ts) contain Bearer-first paths. Mixed-credential tests are essential. |
| Bare service key can create questions | `POST /api/questions` requires a session; GET accepts service auth. The onboarding guide still overstates POST service access. Source takes precedence. |
| Personal completion grant includes discovery | [Models](../../apps/core/app/routes/api/models.ts) does not opt into non-admin grants as [completion](../../apps/core/app/routes/api/completion.ts) does. |
| No password means no login | Installed Better Auth OTP reset can create a missing credential account: `node_modules/better-auth/dist/plugins/email-otp/routes.mjs`, `resetPasswordEmailOTP`. Noninteractive users need explicit lifecycle bans. |
| Reuse request logs without schema work | [Schema](../../apps/core/prisma/schema.prisma), `ApiRequestLog`, requires human `userId`; machine accounting needs a separate identity model. |
| UI/URL registry fields suffice | [Launcher](../../packages/ui/src/launcher-registry.tsx), [bug validation](../../apps/core/app/lib/bug-reports/server.ts), [bug route](../../apps/core/app/routes/api/bug-reports.ts) and `BugReportSource` contain additional fixed identities. |
| Callback alone completes lifecycle | [Cascade](../../apps/core/app/lib/courses/cascadeDelete.server.ts) is best-effort and relies on reconciliation. The outbox is proposed new work. |
| Scaffold can ignore build/ops consumers | [Core Dockerfile](../../apps/core/Dockerfile), [test Dockerfile](../../docker/tests/Dockerfile.eduai), [PR workflow](../../.github/workflows/pr-tests.yml), [backup config](../../infra/cron/lib.sh) and [backup runner](../../infra/cron/backup-nightly.sh) enumerate apps/workspaces. |
| Replace dbseed blindly | [Root package](../../package.json), [Core package](../../apps/core/package.json), [Turbo config](../../turbo.json) have different task contracts. |
| Local Core guarantees AI; CI runs every push | [README](../../README.md) requires inference connectivity/configuration; [workflow](../../.github/workflows/pr-tests.yml) declares specific PR/merge-group/development-push triggers. |
| Live exposure/callback failure proven | [Systemd template](../../infra/production/systemd/eduai-core.service), [env installation](../../infra/production/admin-helper.sh), [QM env example](../../infra/production/question-maker.env.example) show shared-identity/secret risks. [Core env example](../../infra/production/core.env.example) omits `QM_BACKEND_URL`. Live configuration was not inspected. |

## Verification limits

This is a source-verified architecture review, not a runtime audit or completed implementation. No application tests, model calls, deployments or live permission checks were performed. Proposed behavior must pass the design's acceptance checks when implemented.

No issues, comments or PRs were posted. The user's unrelated `MEMORY.md` edit remains outside this work. Include the design explicitly in git despite `docs/superpowers/` being ignored, so later diff-based reviews can see it.
