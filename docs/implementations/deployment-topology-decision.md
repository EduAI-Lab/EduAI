# Deployment Topology Decision

**Status:** Pending team decision  
**Context:** Three independently deployable apps — Core, AI Tutor, Question Maker — that communicate via API. Core is the auth and AI hub; extensions authenticate through Core and call its API.

---

## The Core Problem

Four concerns tie the topology decision together:

- **Auth cookies** — Core-issued session cookies must be readable by extensions. A shared root domain allows a single wildcard cookie; separate domains require explicit token passing between apps.
- **OAuth redirect URIs** — AI Tutor authenticates via Core's OIDC/PKCE flow. The registered redirect URI must exactly match the production URL, so this needs to be locked in before expanding environments.
- **Cross-app API calls** — Extensions call Core's API. Different origins require explicit CORS configuration with credentials; a shared domain avoids this.
- **Scalability** — Each new extension should be deployable without touching existing apps or shared infrastructure config.

---

## Options

### Option A — Shared Root Domain, Subdomains

Each app lives on its own subdomain under one root domain (e.g. `core.edu.ai`, `tutor.edu.ai`, `qm.edu.ai`).

A wildcard cookie on the root domain is shared across all subdomains. Each app still has its own origin, so CORS headers are still needed for browser-initiated cross-app requests — but these are one-time configurations and are straightforward given that the origins are all known and stable.

Adding a new extension means adding a DNS record and setting two environment variables. No changes to existing apps or infrastructure.

Each app can be deployed on the same physical server or on separate servers — the decision is independent and reversible. Changing later requires only a DNS update.

Like all approaches, this still requires a reverse proxy per app (or a shared one) to terminate TLS and route traffic. The difference from path prefixes is that each app's proxy is scoped to that app — a proxy failure affects only that subdomain, not the entire platform.

**Tradeoffs:**
- CORS config required for browser-to-API calls across subdomains (one-time, not ongoing burden)
- Wildcard TLS certificate needed (or per-subdomain certs with auto-renewal)

---

### Option B — Single Domain, Path Prefixes

All apps live under one domain routed by path (e.g. `edu.ai/tutor`, `edu.ai/qm`). A reverse proxy reads the URL path and forwards to the correct backend.

Same-origin eliminates CORS entirely and simplifies cookie sharing. However, every app must be aware of its base path prefix — this affects frontend routing, asset URLs, and OAuth callback construction. These are non-trivial changes to each app and must be maintained as apps evolve.

Path-based routing can technically work with apps on separate servers — the proxy forwards requests to remote addresses rather than local ports. However, the proxy then becomes a hard operational dependency: all traffic for all apps flows through one process, and a proxy misconfiguration or outage affects every app simultaneously.

**Tradeoffs:**
- Each app requires base-path configuration (frontend router, asset bundler, OAuth callbacks)
- Proxy is a single point of failure across all apps even when apps are on separate servers
- Deploying any extension requires a coordinated proxy config change — extensions are no longer fully independent
- Cookie isolation between apps is weaker; all apps share the same origin

---

### Option C — Fully Separate Domains

Each app on its own domain with no shared root. Simple to set up initially, but auth cannot be unified via cookies — each extension needs its own independent auth flow or explicit token-passing logic. Cross-app API calls require permissive CORS with credentials. This approach works against the goal of unified auth and adds permanent ongoing complexity to every cross-app interaction.

Not recommended given the auth architecture.

---

## Recommendation: Option A — Subdomains

Subdomains give each app a clean, stable identity while keeping auth unified through a shared root domain cookie. Extensions deploy independently with no coordination required. The topology can start on a single server and migrate to separate servers per-app with only a DNS change — no app code changes, no proxy reconfig.

The path-prefix approach trades a one-time CORS config for permanent base-path complexity in every app, plus a shared operational failure point. That is the wrong trade for a system designed around independent deployability.

---

## Decision Required

- Confirm root domain (currently `*.ok.ubc.ca` or a new domain?)
- Confirm subdomain naming convention per app
- Confirm whether local dev mirrors prod topology (local proxy) or stays on `localhost:PORT` per app

Once decided, the following need to be aligned across all environments: `COOKIE_DOMAIN`, `BETTER_AUTH_URL`, `EDUAI_BASE_URL`, and OAuth redirect URI registrations in Core.
