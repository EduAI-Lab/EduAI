### How to use the dev server

## Prerequisites
- UBC VPN (or campus network)
- SSH: `ssh YOUR_CWL@dev.eduai.ok.ubc.ca`
- RAG embeddings: set **`EMBEDDING_PROVIDER=local`**, **`OLLAMA_EMBEDDING_MODEL=mxbai-embed-large`**, and **`OLLAMA_BASE_URL`** in `apps/core/.env` (Ollama runs on cmps01). Pull the model once: `ollama pull mxbai-embed-large`. Cloud fallback: **`OPENROUTER_API_KEY`** or **`OPENAI_API_KEY`**. Verify with `npm run test:embedding` from `apps/core`. After the LOCAL-EMBEDDINGS migration, re-embed courses with `npm run re-embed:course -- <courseId>`. See [`EMBEDDINGS.md`](./EMBEDDINGS.md) and [`LOCAL-EMBEDDINGS.md`](./LOCAL-EMBEDDINGS.md).

## Use the app
Open https://dev.eduai.ok.ubc.ca

#### SSH to the server

```bash
ssh YOUR_CWL@dev.eduai.ok.ubc.ca
```

You must be on **UBC VPN** or campus network.

#### Switch dev server to your feature branch

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
git fetch origin
git checkout [your-feature-branch]      # or your feature branch merged with development
git pull origin [your-feature-branch]
npm install   # if dependencies changed
```

After switching branches, refresh your browser tab changes should reflect because 
there is not reload

If it doesn't however, follow these steps

```bash
tmux new -s eduai
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore
npm run docker:dev:db:eduai
npx turbo run dev --filter=edu-ai
```

Detach: `Ctrl+B`, then `D`. Reattach: `tmux attach -t eduai`.


#### Start the dev server (use tmux)

The server process **dies when your SSH session ends**. Use `tmux` so it survives disconnects:



| Command                      | What it does                         |
| ---------------------------- | ------------------------------------ |
| `tmux ls`                    | List active sessions                 |
| `tmux attach -t eduai`       | Reattach to the `eduai` session      |
| `tmux kill-session -t eduai` | Kill the session and stop the server |
| `Ctrl+B` then `D`            | Detach (server keeps running)        |
| `Ctrl+C` (inside tmux)       | Stop the dev process                 |

Apache proxies `https://dev.eduai.ok.ubc.ca` → `http://127.0.0.1:3000`.

#### Auth / login troubleshooting

Required in `apps/core/.env` on the server:

```env
BETTER_AUTH_URL="https://dev.eduai.ok.ubc.ca"
BETTER_AUTH_SECRET="<openssl rand -base64 32>"
DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:54320/eduai?schema=public"
```

After a DB reset, **register a new account** — old passwords are gone.

**Silent login (page reloads, no error):** usually session cookies not stored. Check:

1. Restart dev server after `.env` changes.
2. Browser DevTools → Network → POST `/auth/login` → Response headers: expect **multiple** `Set-Cookie` with `Secure` on HTTPS.
3. From SSH, smoke-test the auth API:

```bash
curl -si -X POST "https://dev.eduai.ok.ubc.ca/api/auth/sign-in/email" \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}' | head -40
```

`401` = wrong credentials. `200` with `Set-Cookie` but browser still fails → cookie `Secure` / `Domain` mismatch (ensure `BETTER_AUTH_URL` is `https://…`, not `localhost`).

Do **not** set `COOKIE_DOMAIN` on the shared dev host unless you intend cross-subdomain cookies (production uses e.g. `.eduai.ok.ubc.ca`).

**Can’t log in again after logout:** use **Log out** in the UI (server `POST /auth/logout`), not only client-side sign-out. Clear site cookies for `dev.eduai.ok.ubc.ca` once if a stale `__Secure-better-auth.session_token` remains. Verify sign-out clears cookies:

```bash
curl -si -X POST "https://dev.eduai.ok.ubc.ca/api/auth/sign-out" \
  -H "Cookie: __Secure-better-auth.session_token=YOUR_TOKEN" | head -20
```

#### When you're done

Switch back to `development` (or `main`) so the server is in a known state for others:

```bash
tmux attach -t eduai
# Ctrl+C to stop, then:
git checkout development
git pull origin development
npm install
npm run docker:dev:db:eduai
npx turbo run dev --filter=edu-ai
```

Detach again with `Ctrl+B`, `D`.
