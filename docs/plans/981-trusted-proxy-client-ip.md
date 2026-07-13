# Issue #981 — Derive client IP from trusted proxy, not raw x-forwarded-for

Branch: `fix/981-trusted-proxy-client-ip` (off `origin/development`)
Target file: `apps/core/app/lib/request-context.server.ts`

## Problem
`readFirstForwardedIp` (`request-context.server.ts:30-56`) takes the **first** token of the
client-controlled `x-forwarded-for` header as the client IP. XFF is appended left-to-right by each
proxy, so the leftmost hop is fully attacker-chosen unless a trusted proxy overwrites it. Result:
forged `ipAddress` in `audit_logs` / `system_logs` and the `/admin/logs` IP-triage filter
(`db.auditlog.server.ts:110-112`). 30 call sites feed this into logging via `getRequestContext`.

## Constraint discovered
- App runs on `react-router-serve` default server (`apps/core/package.json:8`). No custom
  express, no `entry.server`, no `app.set('trust proxy')`.
- **Socket / `remoteAddress` is NOT reachable** in app code — only a web-standard `Request`.
  So the issue's "socket address" option is off the table. Fix is header-only + trusted hop count.
- No existing trusted-proxy config anywhere.

## Approach: trusted-proxy hop count from the RIGHT
Key XFF fact: each proxy APPENDS the IP it received from, left-to-right. So `client, proxy1, ...`.
The **leftmost** entry is attacker-controlled (current bug). The **rightmost** entry is written by
the proxy directly connected to our server — NOT forgeable by the client. Counting `hopCount`
trusted hops in from the right, the client is at `tokens.length - 1 - hopCount`.

1. Add env `TRUSTED_PROXY_HOP_COUNT` (integer, default `0`).
   - `0` = trust only the rightmost (immediate) hop. This is the SAFE default when the number of
     proxies is unknown: rightmost is non-spoofable, and IP recording keeps working (never null
     when XFF present). Worst case behind multiple proxies at default 0 = we log the innermost
     proxy IP, not the true client — imprecise but NOT attacker-poisoned, which is the #981 goal.
   - Bump to `N` once prod topology is known, to skip past N infra hops to the real client.
   - Document in `apps/core` `.env.example` / CLAUDE.md if present.
2. New `deriveClientIp(xff, hopCount)`:
   - Parse XFF into trimmed non-empty tokens.
   - `index = tokens.length - 1 - hopCount`.
   - Return `tokens[index]` if `index >= 0`, else `null` (misconfig / too-few hops → fail closed,
     never fall back to a leftmost spoofable value).
   - NOTE: do NOT special-case hopCount 0 to null — rightmost is trustworthy, and nulling it would
     stop all IP recording in every proxied deployment.
3. Fallback chain (`request-context.server.ts:52-56`):
   - `x-real-ip` and `cf-connecting-ip` are client-forgeable when no trusted proxy overwrites them.
     Keep them as lower-priority fallbacks only (they matter for CF/nginx setups); XFF-derived value
     wins. Acceptable at default 0 since attacker can't beat the rightmost XFF entry. Revisit if
     team wants them gated behind an explicit CF flag.
4. Keep extraction fail-open (never throw).

## Files to touch
- `apps/core/app/lib/request-context.server.ts` — replace `readFirstForwardedIp` with
  `deriveClientIp` + env read (read env once at module scope, parse safely).
- `.env.example` / CLAUDE.md doc note (if `.env.example` exists in apps/core).
- CHANGELOG.md — one-line Fixed entry (top of category).

## Tests (new file `apps/core/app/tests/unit/request-context.test.ts`)
- hopCount 0, XFF `spoof` → returns `spoof` (rightmost==only entry; single direct proxy case).
- hopCount 0, XFF `spoof, lb` → returns `lb` (attacker's prepended `spoof` ignored).
- hopCount 1, XFF `client, lb` → returns `client`.
- hopCount 1, XFF `spoof, client, lb` → returns `client` (attacker prepend ignored).
- hopCount 2 → picks correct index; underflow (hopCount >= len) → `null`.
- absent XFF → `null`; malformed URL → no throw.
- Verify existing mock in `invitations.route.test.ts:23` still compatible.

## Open questions (confirm before coding)
1. Deployment: how many trusted proxies actually sit in front of core in prod (Cloudflare?
   nginx? both)? Sets the default/documented `TRUSTED_PROXY_HOP_COUNT`.
2. Should `x-real-ip` / `cf-connecting-ip` fallbacks be dropped/gated, or kept for CF setups?

## Out of scope
- Changing the 30 call sites (they consume `ipAddress` unchanged).
- Auth XFF re-forwarding (`auth-handler-request.ts:45-46`) — unrelated.
