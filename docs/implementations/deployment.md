# Deployment

**Status:** Living document
**Last updated:** 2026-05-15

This document describes how EduAI is deployed. It covers both development and production environments.

---

## Topology

EduAI uses a shared root domain with per-app subdomains. Each app (Core, AI Tutor, Question Maker, and any future extension) lives on its own subdomain under `eduai.ok.ubc.ca`. Core issues a wildcard session cookie scoped to the root, which all subdomains can read. This keeps auth unified while letting each app deploy independently.

New extensions can be added by registering a subdomain and pointing it at the new app's server — no changes to existing apps or shared infrastructure config required.

---

## Development Deployment

*To be filled in.*

---

## Production Deployment

### Domain Layout

All apps live under `eduai.ok.ubc.ca`. Each app gets its own subdomain:

| App             | Subdomain                     |
| --------------- | ----------------------------- |
| Core            | `eduai.ok.ubc.ca`             |
| AI Tutor        | `ai-tutor.eduai.ok.ubc.ca`    |
| Question Maker  | `qm.eduai.ok.ubc.ca`          |
| Future apps     | `<name>.eduai.ok.ubc.ca`      |

Core issues a session cookie with `Domain=.eduai.ok.ubc.ca`, so all subdomains receive it automatically on requests.

### Server Topology

Each app runs as an independent service. The topology is flexible — apps can be co-located on one server or split across separate servers without changing app code. A reasonable starting point:

- **Single host** running all three apps as separate processes (e.g. systemd services or containers), each bound to a distinct internal port.
- Each app can later move to its own host by updating the relevant subdomain's DNS record. No app-level changes required.

### Reverse Proxy

Each app sits behind a reverse proxy (nginx or Caddy) that:

- Terminates TLS for its subdomain
- Forwards traffic to the app's internal port
- Handles HTTP → HTTPS redirects

The proxy is scoped per-app, not shared across all apps. A misconfiguration or restart on one app's proxy does not affect others. If apps are co-located on one host, a single proxy process can serve multiple subdomains via separate server blocks — this is acceptable as long as the blocks are independent and one app's config changes don't risk breaking another's routing.

### TLS Certificates

Two viable options:

- **Wildcard cert** for `*.eduai.ok.ubc.ca` — one cert covers all current and future subdomains. Requires DNS-01 challenge for renewal.
- **Per-subdomain certs** via Let's Encrypt HTTP-01 — simpler to set up, auto-renewed by Caddy or certbot. New subdomains need a one-time issuance step at provisioning.

Per-subdomain certs are the simpler default; wildcard becomes attractive once the number of extensions grows.

### CORS

Cross-subdomain browser requests require explicit CORS headers from Core's API, since each subdomain is a distinct origin. Configure Core to allow credentialed requests from the known extension origins:

```
Access-Control-Allow-Origin: https://ai-tutor.eduai.ok.ubc.ca
Access-Control-Allow-Credentials: true
```

The allow-list is maintained in Core's config and updated when new extensions are added.

### Cookies

Core issues session cookies with:

```
Domain=.eduai.ok.ubc.ca
Secure
HttpOnly
SameSite=Lax
```

`SameSite=Lax` is sufficient for top-level navigation between subdomains. If any cross-subdomain background fetches need to send cookies, `SameSite=None; Secure` will be required instead — revisit if/when that pattern shows up.

### OAuth Redirect URIs

Core's OIDC client registrations must list the exact production redirect URI for each extension (e.g. `https://ai-tutor.eduai.ok.ubc.ca/auth/callback`). These are registered once per extension at provisioning time and must not change without coordinated updates on both sides.

### Adding a New Extension

1. Register the subdomain DNS A/AAAA record pointing at the target host
2. Issue a TLS cert for the subdomain
3. Add a reverse proxy server block for the subdomain
4. Add the extension's origin to Core's CORS allow-list
5. Register the extension's redirect URI in Core's OIDC client config
6. Deploy the app

No changes to existing apps required.